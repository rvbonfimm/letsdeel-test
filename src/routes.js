const router = require("express").Router();
const { Op } = require("sequelize");

const { getProfile } = require("./middleware/getProfile");

// TODO general refactor - Create generic function for check user profile
// TODO general refactor - Create generic function for query filters

/**
 * It should return the contract only if it belongs to the profile calling
 * @returns contract by id
 */
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

/**
 * Returns a list of contracts belonging to a user (client or contractor).
 * The list should only contain non terminated contracts.
 * @returns contracts
 */
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

/**
 * Get all unpaid jobs for a user (either a client or contractor).
 * For active contracts only.
 * @returns jobs
 */
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

// TODO limit user authenticated to the user contract
// TODO improve find+update operation to use only one
/**
 * Pay for a job (Client to contractor)
 * A client can only pay if his balance >= the amount to pay
 * The amount should be moved from the client's balance to the contractor balance
 * @returns operation status
 */
router.post("/jobs/:id/pay", getProfile, async (req, res) => {
  const { Job, Contract, Profile } = req.app.get("models");
  const sequelize = req.app.get("sequelize");
  const { id } = req.params;

  const jobId = parseInt(id);
  const job = await Job.findOne({ where: { id: jobId } });
  if (!job) return res.status(404).end();

  /** Check for job already opened */
  if (job.paid !== null) return res.json("Job already paid");

  /** Get the contract associated with the Current Authenticated Profile + Job Contract Id */
  const contract = await Contract.findOne({ where: { id: job.ContractId } });
  if (!contract) {
    return res
      .status(404)
      .json({
        error: "Job Contract not found",
      })
      .end();
  }

  /** Check for contract status */
  if (contract.status === "terminated") return res.json("Contract already finished")
  
  /** Check for the authenticated user profile */
  const profile = req.profile;
  if (profile.type !== 'client') return res.json("Profile type not allowed to manage a Job Contract")

  if (contract.ClientId !== profile.id) return res.json("Profile not allowed to manage a Job Contract")

  /** Check for client balance to the payment */
  if (profile.balance < job.price) {
    return res.json("You do not have sufficient money to pay the job");
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
      paymentDate: new Date()
      },
      { where: { id: jobId } }
    )

    return res.json({ status: "success" });
  } catch (error) {
    await transaction.rollback();
    return res.json({ error });
  }
});

module.exports = router;
