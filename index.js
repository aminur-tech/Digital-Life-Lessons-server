const express = require('express');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const cors = require('cors');
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_API_KEY)

const admin = require("firebase-admin");
const { count } = require('console');
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8')
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const app = express();
const port = process.env.PORT || 3000;

// Middlewares
app.use(express.json());
app.use(cors());

const verifyFBToken = async (req, res, next) => {
  // console.log('verify', req.headers.authorization)
  const token = req.headers.authorization
  if (!token) {
    return res.status(401).send({ message: 'unAuthorized access' })
  }
  try {
    const idToken = token.split(' ')[1]
    const decoded = await admin.auth().verifyIdToken(idToken)
    console.log('decode in the token', decoded)
    req.decoded_email = decoded.email
    next()
  }
  catch (err) {
    return res.status(401).send({ message: 'unauthorized access' })

  }
}

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

    // verify with more database access with admin
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded_email
      const query = { email }
      const user = await userConnection.findOne(query)
      if (!user || user.role !== 'admin') {
        return res.status(403).send({ message: 'forbidden access' })
      }
      next()
    }

    // user related api 
    app.get('/users', async (req, res) => {
      const users = await userConnection.find().toArray();
      res.send(users);
    })

    // Get premium status by email
    app.get("/users/premium/:email", async (req, res) => {
      try {
        const email = req.params.email;
        const user = await userConnection.findOne({ email });

        if (!user) {
          return res.send({ isPremium: false });
        }

        res.send({ isPremium: user.isPremium === true });
      } catch (err) {
        console.error(err);
        res.status(500).send({ error: "Failed to fetch premium status" });
      }
    });

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
      user.isPremium = false;
      user.premiumAt = null;
      user.transaction = null;
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
      // Find current user
      const user = await userConnection.findOne({ _id: new ObjectId(id) });
      // Toggle role
      const newRole = user.role === 'admin' ? 'user' : 'admin';

      const result = await userConnection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { role: newRole } }
      );

      res.send({ message: `User role updated to ${newRole}`, result });

    });

    // Delete user 
    app.delete('/users/:id', async (req, res) => {
      const { id } = req.params;
      const result = await userConnection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });


    // lesson related api 
    // public lesson 
    app.get("/lessons/public", async (req, res) => {
      try {
        const allLessons = await lessonsCollection
          .find({})
          .sort({ createdAt: -1 })
          .toArray();

        // Map lessons to send minimal info for private lessons if requester is not creator
        const filteredLessons = allLessons.map((lesson) => {
          if (lesson.privacy === "Private") {
            // Remove sensitive fields for non-creator view (frontend will handle blur)
            return {
              _id: lesson._id,
              title: lesson.title,
              description: lesson.description.slice(0, 80), // preview only
              category: lesson.category,
              emotionalTone: lesson.emotionalTone,
              tone: lesson.tone,
              creatorName: lesson.creatorName,
              creatorPhoto: lesson.creatorPhoto || lesson.image,
              email: lesson.email,
              privacy: lesson.privacy,
              accessLevel: lesson.accessLevel,
              createdAt: lesson.createdAt,
            };
          }
          return lesson;
        });

        res.send(filteredLessons);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Failed to load lessons" });
      }
    });


    // GET lessons by user email
    app.get('/lessons/my/:email', async (req, res) => {
      const { email } = req.params; // <-- get from params
      try {
        const lessons = await lessonsCollection.find({ email }).toArray(); // <-- author field
        res.send(lessons);
      } catch (err) {
        res.status(500).send({ error: 'Failed to fetch lessons' });
      }
    });



    app.post("/lessons", async (req, res) => {
      const lesson = req.body;
      const result = await lessonsCollection.insertOne(lesson);
      res.send({ success: true, lessonId: result.insertedId });
    });

    app.patch('/lessons/:id', async (req, res) => {
      const { id } = req.params;
      const { title, description, visibility, access, userId } = req.body;

      try {
        const lesson = await lessonsCollection.findOne({ _id: new ObjectId(id) });
        if (!lesson) return res.status(404).send({ error: 'Lesson not found' });

        // If user is changing access to Premium, verify user subscription
        if (access === 'premium') {
          const user = await userConnection.findOne({ _id: new ObjectId(userId) });
          if (!user?.isPremium) {
            return res.status(403).send({ error: 'Only Premium users can set Premium access' });
          }
        }

        // Update only allowed fields
        const updates = {
          ...(title && { title }),
          ...(description && { description }),
          ...(visibility && { visibility }),
          ...(access && { access }),
        };

        await lessonsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updates }
        );

        res.send({ success: true });
      } catch (err) {
        console.error(err);
        res.status(500).send({ error: 'Failed to update lesson' });
      }
    });


    app.delete('/lessons/:id/:userId', async (req, res) => {
      const { id, userId } = req.params;

      try {
        const lesson = await lessonsCollection.findOne({ _id: new ObjectId(id) });
        if (!lesson) return res.status(404).send({ error: 'Lesson not found' });

        await lessonsCollection.deleteOne({ _id: new ObjectId(id) });
        res.send({ success: true });
      } catch (err) {
        res.status(500).send({ error: 'Failed to delete lesson' });
      }
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


    app.get('/payment-success', async (req, res) => {
      try {
        const sessionId = req.query.session_id;

        if (!sessionId) return res.status(400).send({ error: "Missing session_id" });

        const session = await stripe.checkout.sessions.retrieve(sessionId);
        console.log(session)
        if (session.payment_status === "paid") {
          const email = session.customer_email
          const transactionData = {
            id: session.payment_intent,
            amount: session.amount_total / 100,
            currency: session.currency,
            paidAt: new Date(),
          };
          // console.log(session.customer_email)
          // console.log(session.customer_details)

          // Update user properly
          const user = await userConnection.updateOne(
            { email }, // filter
            { $set: { isPremium: true, premiumAt: new Date(), transaction: transactionData } }
          );
          console.log(user, email)

          const updatedUser = await userConnection.findOne({ email });

          return res.send({
            transaction: transactionData,
            user: updatedUser
          });
        }

        res.send({ message: "Payment incomplete" });
      } catch (err) {
        console.error("Payment success error:", err);
        res.status(500).send({ error: "Internal server error" });
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