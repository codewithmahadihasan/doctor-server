const express = require('express');
const cors = require('cors');
const port = process.env.PORT || 5000
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const { query } = require('express');
require('dotenv').config()
const stripe = require("stripe")(process.env.SECRET_KEY);


const app = express()


app.use(cors())
app.use(express.json())




// const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.hlyc9ph.mongodb.net/?retryWrites=true&w=majority`;

const uri = 'mongodb://localhost:27017'
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });


function verifyJWT(req, res, next) {

    const headers = req.headers.auth
    if (!headers) {
        return res.status(401).send('you are not a valid user')
    }

    const token = headers.split(' ')[1]
    jwt.verify(token, process.env.TOKEN_PIN, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: 'Please login again' })
        }
        req.decoded = decoded
        next()
    });


}

async function run() {
    try {

        const appointmentCollection = client.db('Doctor').collection('appointment')
        const bookingCollection = client.db('Doctor').collection('booking')
        const userCollection = client.db('Doctor').collection('user')
        const doctorsCollection = client.db('Doctor').collection('doctors')
        const paymentCollection = client.db('Doctor').collection('payment')



        const verifyAdmin = async (req, res, next) => {
            const decodedEmail = req.decoded.email
            const query = { email: decodedEmail }
            const user = await userCollection.findOne(query)
            if (user?.role !== 'admin') {
                return res.status(403).send({ message: 'You are not a admin' })
            }
            next()

        }


        app.post("/create-payment-intent", async (req, res) => {
            const booking = req.body;
            const price = booking.price
            const amount = price * 100
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: "usd",
                "payment_method_types": [
                    'card'
                ]
            });

            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        });


        app.post('/payment', async (req, res) => {
            const data = req.body
            const result = await paymentCollection.insertOne(data)
            const id = data.bookingId
            const filter = { _id: ObjectId(id) }
            const updateDoc = {
                $set: {
                    paid: true,
                    transactionId: data.transaction
                }
            }
            const updateResult = await bookingCollection.updateOne(filter, updateDoc)
            res.send(result)
        })



        app.get('/jwt', async (req, res) => {
            const email = req.query.email
            const query = { email: email }
            const user = await userCollection.findOne(query)
            if (user) {
                const token = jwt.sign({ email }, process.env.TOKEN_PIN, { expiresIn: '1d' })
                return res.send({ accessToken: token })
            }
            res.status(401).send({ message: 'Unauthorize' })
        })


        app.get('/appointment', async (req, res) => {
            const requestDate = req.query.date

            const query = {}

            const option = await appointmentCollection.find(query).toArray()
            const bookingQuary = { date: requestDate }

            const booked = await bookingCollection.find(bookingQuary).toArray()

            booked.length && option.forEach(o => {
                const optionBooked = booked.filter(book => book.subject === o.name)
                const bookedSlots = optionBooked.map(book => book.slot)
                const remaining = o.slots.filter(slot => !bookedSlots.includes(slot))
                o.slots = remaining

            })

            res.send(option)
        })


        app.post('/booking', async (req, res) => {
            const booking = req.body

            const query = {
                date: booking.date,
                email: booking.email,
                subject: booking.subject
            }
            const alreadyBooked = await bookingCollection.find(query).toArray()

            if (alreadyBooked.length) {
                const message = `You have already booked on ${booking.subject} on ${booking.date}`
                return res.send({ acknowledged: false, message })
            }

            const result = await bookingCollection.insertOne(booking)

            res.send(result)
        })

        app.get('/booking', verifyJWT, async (req, res) => {
            const email = req.query.email
            const head = req.headers.auth
            const query = { email: email }
            const booking = await bookingCollection.find(query).toArray()
            res.send(booking)
        })

        app.get('/booking/:id', async (req, res) => {
            const id = req.params.id
            const query = { _id: ObjectId(id) }
            const booking = await bookingCollection.findOne(query)
            res.send(booking)
        })

        app.post('/users', async (req, res) => {
            const user = req.body
            const email = req.body.email

            const query = { email: email }

            const newUser = await userCollection.find(query).toArray()

            if (newUser.length > 0) {
                console.log('data')
                return res.send('This user is allready created')
            }
            else {
                const result = await userCollection.insertOne(user)
                res.send(result)
            }
        })


        app.get('/user', async (req, res) => {
            const query = {}
            const result = await userCollection.find(query).toArray()
            res.send(result)
        })

        app.delete('/user/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id
            const query = { _id: ObjectId(id) }
            const result = await userCollection.deleteOne(query);
            res.send(result)
        })

        app.put('/user/admin/:id', verifyJWT, async (req, res) => {
            const decodedEmail = req.decoded.email
            const query = { email: decodedEmail }
            const user = await userCollection.findOne(query)
            if (user?.role !== 'admin') {
                return res.status(403).send({ message: 'You are not a admin' })
            }
            const id = req.params.id
            const filter = { _id: ObjectId(id) }
            const options = { upsert: true };
            const updateDoc = {
                $set: {
                    role: 'admin'
                },
            };
            const result = await userCollection.updateOne(filter, updateDoc, options)
            res.send(result)
        })

        app.get('/user/admin/:email', async (req, res) => {
            const email = req.params.email
            const query = { email }
            const user = await userCollection.findOne(query)
            res.send({ idAdmin: user?.role === 'admin' })
        })

        app.get('/specialty', async (req, res) => {
            const query = {}
            const result = await appointmentCollection.find(query).project({ name: 1 }).toArray()
            res.send(result)
        })


        app.post('/doctors', verifyJWT, verifyAdmin, verifyAdmin, async (req, res) => {
            const doctor = req.body
            const result = await doctorsCollection.insertOne(doctor)
            res.send(result)
        })

        app.get('/doctors', verifyJWT, verifyAdmin, async (req, res) => {
            const query = {}
            const result = await doctorsCollection.find(query).toArray()
            res.send(result)
        })



        app.delete('/doctors/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id
            const query = { _id: ObjectId(id) }
            const result = await doctorsCollection.deleteOne(query);
            res.send(result)
        })

        // app.get('/v2/appointment', async (req, res) => {
        //     const select = req.query.date
        //     const options = await appointmentCollection.aggregate([
        //         {
        //             $lookup:
        //             {
        //                 from: 'booking',
        //                 localField: 'name',
        //                 foreignField: 'subject',
        //                 pipeline: [{
        //                     $match: {
        //                         $expr: {
        //                             $eq: ['date', select]
        //                         }
        //                     }
        //                 }],
        //                 as: 'booked'
        //             }

        //         },
        //         {
        //             $project: {
        //                 name: 1,
        //                 slots: 1,
        //                 booked: {
        //                     $map: {
        //                         input: "$booked",
        //                         as: "book",
        //                         in: "$$book.slot"
        //                     }
        //                 }
        //             }
        //         },
        //         {
        //             $project: {
        //                 name: 1,
        //                 slots: {

        //                     $setDifference: ["$slots", "$booked"]
        //                 }

        //             }
        //         }
        //     ]).toArray()
        //     res.send(options)
        // })

    }
    finally {

    }

}
run().catch(console.error)



app.get('/', async (req, res) => {
    res.send('server is running ')
})

app.listen(port, () => console.log(`server is running port on ${port}`))