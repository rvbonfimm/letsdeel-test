const router = require("express").Router();
const { Op } = require("sequelize");

const { getProfile } = require("./middleware/getProfile");

// TODO general refactor - Create generic function for check user profile
// TODO general refactor - Create generic function for query filters
// TODO separate services from route/controller flow

router.get("/contracts/:id", getProfile, async (req, res) => {
  const { Contract } = req.app.get("models");
  const { id } = req.params;

  let filters = { id: parseInt(id) };
  const profile = req.profile;
  const profileType = profile.type;
  switch (profileType) {
    case "client":
      filters["ClientId"] = profile.id;
      break;
    case "contractor":
      filters["ContractorId"] = profile.id;
      break;
  }

  const contract = await Contract.findOne({ where: filters });
  if (!contract) return res.status(404).end();
  res.json(contract);
});

router.get("/contracts", getProfile, async (req, res) => {
  const { Contract } = req.app.get("models");

  let filters = {
    status: {
      [Op.in]: ["new", "in_progress"],
    },
  };
  const profile = req.profile;
  const profileType = profile.type;
  switch (profileType) {
    case "client":
      filters["ClientId"] = profile.id;
      break;
    case "contractor":
      filters["ContractorId"] = profile.id;
      break;
  }

  const contracts = await Contract.findAll({ where: filters });
  if (!contracts) return res.status(404).end();
  res.json(contracts);
});

router.get("/jobs/unpaid", getProfile, async (req, res) => {
  const { Contract, Job } = req.app.get("models");

  const jobs = await Job.findAll({
    where: {
      paid: null,
    },
  });

  if (!jobs) return res.status(404).end();

  let filters = {
    status: { [Op.in]: ["new", "in_progress"] },
  };
  const profile = req.profile;
  const profileType = profile.type;
  switch (profileType) {
    case "client":
      filters["ClientId"] = profile.id;
      break;
    case "contractor":
      filters["ContractorId"] = profile.id;
      break;
  }

  /** Search for Active Contracts only */
  let desiredJobs = [];
  for await (const job of jobs) {
    const contractId = job.ContractId;

    filters["id"] = contractId;

    const contract = await Contract.findOne({ where: filters });
    if (!contract) continue;

    desiredJobs.push(job);
  }

  if (desiredJobs.length === 0) return res.status(404).end();
  res.json(desiredJobs);
});

// TODO improve find+update operation to use only one
router.post("/jobs/:id/pay", getProfile, async (req, res) => {
  const { Job, Contract, Profile } = req.app.get("models");
  const sequelize = req.app.get("sequelize");
  const { id } = req.params;

  const jobId = parseInt(id);
  const job = await Job.findOne({ where: { id: jobId } });
  if (!job) return res.status(404).end();

  /** Check for job already opened */
  if (job.paid !== null) return res.json({ error: "Job already paid" });

  /** Get the contract associated with the Current Authenticated Profile + Job Contract Id */
  const contract = await Contract.findOne({ where: { id: job.ContractId } });
  if (!contract) {
    return res.status(404).json({
      error: "Job Contract not found",
    });
  }

  /** Check for contract status */
  if (contract.status === "terminated") {
    return res.json({ error: "Contract already finished" });
  }

  /** Check for the authenticated user profile */
  const profile = req.profile;
  if (profile.type !== "client") {
    return res.json({
      error: "Profile type not allowed to manage a Job Contract",
    });
  }

  if (contract.ClientId !== profile.id) {
    return res.json({
      error: "Profile not allowed to manage a Job Contract",
    });
  }

  /** Check for client balance to the payment */
  if (profile.balance < job.price) {
    return res.json({
      error: "You do not have sufficient money to pay the job",
    });
  }

  const clientId = contract.ClientId;
  const contractorId = contract.ContractorId;

  const transaction = await sequelize.transaction();
  const jobClient = await Profile.findOne({ where: { id: clientId } });
  const jobContractor = await Profile.findOne({ where: { id: contractorId } });
  try {
    /** Withdraw from client */
    const clientBalance = jobClient.balance - job.price;
    await Profile.update(
      { balance: clientBalance },
      { where: { id: clientId } },
      { transaction }
    );

    /** Deposit to contractor */
    const contractorBalance = jobContractor.balance + job.price;
    await Profile.update(
      { balance: contractorBalance },
      { where: { id: contractorId } }
    );

    /** Update current Job as paid */
    await Job.update(
      {
        paid: 1,
        paymentDate: new Date(),
      },
      { where: { id: jobId } }
    );

    return res.json({ status: "Job paid successfully" });
  } catch (error) {
    await transaction.rollback();
    return res.json({ error });
  }
});

// TODO improve find+update operation to use only one
router.post("/balances/deposit/:user_id", getProfile, async (req, res) => {
  const { Profile, Job, Contract } = req.app.get("models");
  const sequelize = req.app.get("sequelize");
  const { user_id: userId } = req.params;

  if (!req.body.amount) {
    return res.status(400).json({
      error: "Amount not provided to the deposit",
    });
  }

  const { amount } = req.body;

  const profile = req.profile;
  const profileType = profile.type;
  if (profileType !== "client") {
    return res.json({
      error: "Profile type not allowed to manage a Job Contract",
    });
  }

  let profileJobs = [];
  const jobs = await Job.findAll({
    where: {
      paid: null,
    },
  });
  for await (const job of jobs) {
    const contractId = job.ContractId;

    const contract = await Contract.findOne({ where: { id: contractId } });
    if (!contract) continue;

    if (contract.ClientId === profile.id) profileJobs.push(job);
  }

  let paymentAmount = null;
  if (profileJobs.length === 0) paymentAmount = 0;

  const initialValue = 0;
  paymentAmount = profileJobs.reduce(
    (acc, actual) => acc + actual.price,
    initialValue
  );

  const limitPermittedToDeposit = (paymentAmount * 25) / 100;

  /** Check for deposit limit */
  if (amount > limitPermittedToDeposit) {
    const formatter = Intl.NumberFormat("pt-br", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return res.json({
      error: `Limit exceeded to be deposited - ${
        profileJobs.length
      } pending jobs (Amount: ${formatter.format(
        paymentAmount
      )} / Limit: ${formatter.format(limitPermittedToDeposit)})`,
    });
  }

  const userProfile = await Profile.findOne({ where: { id: userId } });
  if (!userProfile) {
    return res.json({
      error: "User Profile not found to the deposit",
    });
  }

  /** Clients pays for Jobs to Contractors */
  if (userProfile.type !== "client") {
    return res.json({
      error: "Profile type to the deposit not allowed to manage a Job Contract",
    });
  }

  const transaction = await sequelize.transaction();
  try {
    /** Withdraw from authenticated profile */
    const profileBalance = profile.balance - amount;
    await Profile.update(
      { balance: profileBalance },
      { where: { id: profile.id } },
      { transaction }
    );

    /** Deposit to the User Profile provided */
    const userBalance = userProfile.balance + amount;
    await Profile.update(
      { balance: userBalance },
      { where: { id: userProfile.id } },
      { transaction }
    );

    return res.json({ message: "Deposit finished successfully" });
  } catch (error) {
    transaction.rollback();
    return res.json({ error });
  }
});

module.exports = router;
