require('dotenv').config(); // Load env variables
const express = require('express');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

// Middlewares
app.use(express.json());
app.use(cors());

// MongoDB URI
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.f47fo9z.mongodb.net/?appName=Cluster0`;

// MongoClient setup
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        await client.connect();
        const db = client.db('Digital-Life-Lesson')
        const userConnection = db.collection('users')

        // user related api 
        app.get('/users', async (req, res) => {
            const users = await userConnection.find().toArray();
            res.send(users);
        })

        // Get user role by email
        app.get('/users/role/:email', async (req, res) => {
            const email = req.params.email;
            const user = await userConnection.findOne({ email: email });

            if (!user) {
                return res.send({ role: null });
            }
            res.send({ role: user.role });
        });


        app.post('/users', async (req, res) => {
            const user = req.body;
            user.role = 'user'
            user.createAt = new Date()

            // already user || check social sign in
            const email = user.email
            const userExits = await userConnection.findOne({ email: email })
            if (userExits) {
                return res.send({ message: 'user exits' })
            }

            const result = await userConnection.insertOne(user)
            res.send(result)
        })

        // Promote user to admin
        app.patch('/users/admin/:id', async (req, res) => {
            const { id } = req.params;

            try {
                const result = await userConnection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { role: 'admin' } }
                );
                res.send(result);
            } catch (err) {
                res.status(500).send({ error: 'Failed to update role' });
            }
        });

        // Delete user 
        app.delete('/users/:id', async (req, res) => {
            const { id } = req.params;
            try {
                const result = await userConnection.deleteOne({ _id: new ObjectId(id) });
                res.send(result);
            } catch (err) {
                res.status(500).send({ error: 'Failed to delete user' });
            }
        });



        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } catch (err) {
        console.error(err);
    }
}

run().catch(console.dir);

// Routes
app.get('/', (req, res) => {
    res.send('Hello World!');
});

// Start server
app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});
