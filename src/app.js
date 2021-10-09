const express = require('express');
const bodyParser = require('body-parser');
const {sequelize} = require('./model')
const {getProfile} = require('./middleware/getProfile')
const app = express();
app.use(bodyParser.json());
app.set('sequelize', sequelize)
app.set('models', sequelize.models)

/**
 * It should return the contract only if it belongs to the profile calling
 * @returns contract by id
 */
app.get('/contracts/:id',getProfile ,async (req, res) =>{
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
module.exports = app;
