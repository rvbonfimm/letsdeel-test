const router = require('express').Router()
const { Op } = require("sequelize");

const {getProfile} = require('./middleware/getProfile')

/**
 * It should return the contract only if it belongs to the profile calling
 * @returns contract by id
 */
router.get('/contracts/:id',getProfile ,async (req, res) =>{
    const {Contract} = req.app.get('models')
    const {id} = req.params

    let filters = { id: parseInt(id) }
    const profile = req.profile
    const profileType = profile.type
    switch (profileType) {
        case "client":
            filters["ClientId"] = profile.id
            break
        case "contractor":
            filters["ContractorId"] = profile.id
            break
    }

    const contract = await Contract.findOne({where: filters})
    if(!contract) return res.status(404).end()
    res.json(contract)
})

/**
 * Returns a list of contracts belonging to a user (client or contractor).
 * The list should only contain non terminated contracts.
 * @returns contracts
 */
router.get('/contracts', getProfile, async (req, res) => {
    const {Contract} = req.app.get('models')

    let filters = { 
        status: {
            [Op.in]: ['new', 'in_progress']
        }    
    }
    const profile = req.profile
    const profileType = profile.type
    switch (profileType) {
        case "client":
            filters["ClientId"] = profile.id
            break
        case "contractor":
            filters["ContractorId"] = profile.id
            break
    }

    const contracts = await Contract.findAll({ where: filters })
    if (!contracts) return res.status(404).end()
    res.json(contracts)
})

module.exports = router
