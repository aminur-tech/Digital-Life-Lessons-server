// Load env variables
const express = require('express');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const cors = require('cors');
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_API_KEY)

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
    const lessonsCollection = db.collection('lessons')
    


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


    // Toggle user role between 'user' and 'admin'
    app.patch('/users/role/:id', async (req, res) => {
      const { id } = req.params;

      try {
        // Find current user
        const user = await userConnection.findOne({ _id: new ObjectId(id) });
        if (!user) {
          return res.status(404).send({ error: 'User not found' });
        }

        // Toggle role
        const newRole = user.role === 'admin' ? 'user' : 'admin';

        const result = await userConnection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { role: newRole } }
        );

        res.send({ message: `User role updated to ${newRole}`, result });
      } catch (err) {
        console.error(err);
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

    // lesson related api 
    app.post("/lessons", async (req, res) => {
      const lesson = req.body;
      const result = await lessonsCollection.insertOne(lesson);
      res.send({ success: true, lessonId: result.insertedId });
    });


    // payment related api 
    app.post('/create-checkout-session', async (req, res) => {
      const { userId, email } = req.body;

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: 'usd',
              unit_amount: 1500,
              product_data: { name: "Premium Membership" }
            },
            quantity: 1
          }
        ],
        mode: 'payment',
        customer_email: email,
        metadata: { userId },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancel`
      });

      res.send({ url: session.url });
    });

    app.patch('/payment-success', async (req, res) => {
      const sessionId = req.query.session_id;

      const session = await stripe.checkout.sessions.retrieve(sessionId);
      // console.log(session)

      if (session.payment_status === "paid") {
        const userId = session.metadata.userId;

        const transactionData = {
          id: session.payment_intent,
          amount: session.amount_total / 100,
          currency: session.currency,
          paidAt: new Date(),
        };

        await usersCollection.updateOne(
          { _id: new ObjectId(userId) },
          {
            $set: {
              isPremium: true,
              premiumAt: new Date(),
              transaction: transactionData,
            },
          }
        );

        // RETURN UPDATED USER
        const updatedUser = await usersCollection.findOne({ _id: new ObjectId(userId) });

        return res.send(updatedUser);
      }

      res.send({ message: "Payment incomplete" });
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