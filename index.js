const express = require('express');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const cors = require('cors');
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_API_KEY)

const admin = require("firebase-admin");
const { count } = require('console');
const { features } = require('process');
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
    const favoritesCollection = db.collection('favorites');
    const lessonReportsCollection = db.collection('lessonReports');
    const commentsCollection = db.collection('comments');


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

    // update photo 
    app.patch("/users/update-photo", verifyFBToken, async (req, res) => {
      const email = req.decoded_email;
      const { photoURL } = req.body;

      await userConnection.updateOne(
        { email },
        { $set: { image: photoURL } }
      );

      res.send({ success: true });
    });

    // update name 
    app.patch("/users/update-name", verifyFBToken, async (req, res) => {
      const email = req.decoded_email;
      const { name } = req.body;

      const result = await userConnection.updateOne(
        { email },
        { $set: { name } }
      );

      res.send({ success: true });
    });



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
        const Lessons = await lessonsCollection.find({ privacy: "Public" })
          .sort({ createdAt: -1 })
          .toArray();

        res.send(Lessons);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Failed to load lessons" });
      }
    });


    // GET lessons by user email
    app.get('/lessons/my/:email', async (req, res) => {
      const { email } = req.params; // <-- get from params
      try {
        const lessons = await lessonsCollection.find({ email }).toArray();
        res.send(lessons);
      } catch (err) {
        res.status(500).send({ error: 'Failed to fetch lessons' });
      }
    });

    //  home pages feature
    app.get("/lessons/featured", async (req, res) => {
      try {
        const featured = await lessonsCollection
          .find({ featured: true })
          .sort({ createdAt: -1 })
          .limit(8)
          .toArray();

        res.send(featured);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Failed to load featured lessons" });
      }
    });

    // lesson for lessons details 
    app.get("/lessons/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const lesson = await lessonsCollection.findOne({ _id: new ObjectId(id) })
        res.send(lesson);
      } catch (err) {
        res.status(500).send({ error: "Failed to load lesson" });
      }
    });

    // favorite related api
    // get favorite
    app.get("/favorites/:email", async (req, res) => {
      const result = await favoritesCollection.find({ userEmail: req.params.email }).toArray();
      res.send(result);
    });



    // favorite  post
    app.post("/favorites/toggle", verifyFBToken, async (req, res) => {
      const { lessonId, lessonImage, lessonTitle, lessonDescription, category } = req.body;
      const userEmail = req.decoded_email;

      if (!lessonId || !userEmail) {
        return res.status(400).send({ error: "Missing required fields" });
      }

      try {
        const exists = await favoritesCollection.findOne({ lessonId, userEmail });

        if (exists) {
          await favoritesCollection.deleteOne({ lessonId, userEmail });
          return res.send({ favorited: false });
        }

        await favoritesCollection.insertOne({
          lessonId,
          userEmail,
          lessonImage,
          lessonTitle,
          lessonDescription,
          category,
          createdAt: new Date()
        });

        res.send({ favorited: true });
      } catch (err) {
        console.error("Favorite toggle error:", err);
        res.status(500).send({ error: "Failed to toggle favorite" });
      }
    });

    // Get author profile + their lessons + favorites count
    app.get("/author/:email", async (req, res) => {
      const email = req.params.email;

      try {
        // 1. Get user info
        const user = await userConnection.findOne(
          { email },
          { projection: { password: 0 } } // hide sensitive info
        );

        if (!user) return res.status(404).send({ message: "Author not found" });

        // 2. Get all lessons by author
        const lessons = await lessonsCollection.find({ email }).sort({ createdAt: -1 }).toArray();

        // 3. Get total favorites count for this author
        const favoritesCount = await favoritesCollection.countDocuments({ userEmail: email });

        res.send({
          user,
          lessons,
          favoritesCount
        });
      } catch (err) {
        console.error(err);
        res.status(500).send({ error: "Failed to fetch author profile" });
      }
    });



    // smiler lessons
    app.get("/lessons/similar/:id", async (req, res) => {
      const id = req.params.id;

      const current = await lessonsCollection.findOne({ _id: new ObjectId(id) });
      if (!current) return res.send([]);

      const similar = await lessonsCollection
        .find({
          _id: { $ne: new ObjectId(id) },
          $or: [
            { category: current.category },
            { emotionalTone: current.tone }
          ]
        })
        .toArray();

      res.send(similar);
    });




    // report lesson related api
    app.get("/reported-lessons", verifyFBToken, verifyAdmin, async (req, res) => {
      const reports = await lessonReportsCollection.find().sort({ createdAt: -1 })
        .toArray();
      // console.log(reports)
      res.send(reports);
    });

    app.post("/lessons/report", verifyFBToken, async (req, res) => {
      try {
        const { lessonId, reason, details, author_Name, author_Email, reporter, author_Img } = req.body;

        const report = {
          lessonId,
          reason,
          details,
          author_Name,
          author_Email,
          reporter,
          author_Img,
          createdAt: new Date(),
        };

        await lessonReportsCollection.insertOne(report);

        res.send({ success: true });
      } catch (err) {
        console.error(err);
        res.status(500).send({ error: "Failed to submit report" });
      }
    });


    // comment related api 
    // get comment
    app.get("/comments/:lessonId", async (req, res) => {
      const lessonId = req.params.lessonId;

      const comments = await commentsCollection
        .find({ lessonId })
        .sort({ createdAt: 1 })
        .toArray();

      // Nest replies under parent comments
      const nestedComments = comments
        .filter(c => !c.parentId)
        .map(parent => ({
          ...parent,
          replies: comments.filter(c => c.parentId?.toString() === parent._id.toString())
        }));

      res.send(nestedComments);
    });


    // add comment 
    app.post("/comments", verifyFBToken, async (req, res) => {
      const { lessonId, comment, parentId } = req.body;
      const user = await userConnection.findOne({ email: req.decoded_email });

      const commentData = {
        lessonId,
        comment,
        parentId: parentId || null,
        userEmail: req.decoded_email,
        userName: user?.name || user?.email,
        userImage: user?.image || null,
        likes: [],
        createdAt: new Date()
      };

      const result = await commentsCollection.insertOne(commentData);
      res.send(result);
    });

    app.post("/comments/like", verifyFBToken, async (req, res) => {
      const { commentId, isReply } = req.body;
      const userId = req.body.userId || req.decoded_email; // fallback to email if needed

      if (!commentId || !userId) return res.status(400).send({ error: "Missing commentId or userId" });

      const comment = await commentsCollection.findOne({ _id: new ObjectId(commentId) });
      if (!comment) return res.status(404).send({ error: "Comment not found" });

      const liked = comment.likes.includes(userId);
      const update = liked
        ? { $pull: { likes: userId } }
        : { $addToSet: { likes: userId } };

      await commentsCollection.updateOne({ _id: new ObjectId(commentId) }, update);
      res.send({ liked: !liked });
    });



    app.patch("/comments/like/:id", verifyFBToken, async (req, res) => {
      const commentId = req.params.id;
      const email = req.decoded_email;

      const comment = await commentsCollection.findOne({ _id: new ObjectId(commentId) });
      const liked = comment.likes.includes(email);

      const update = liked
        ? { $pull: { likes: email } }
        : { $addToSet: { likes: email } };

      await commentsCollection.updateOne({ _id: new ObjectId(commentId) }, update);
      res.send({ liked: !liked });
    });


    app.delete("/comments/:id", verifyFBToken, async (req, res) => {
      const commentId = req.params.id;
      const email = req.decoded_email;

      const comment = await commentsCollection.findOne({ _id: new ObjectId(commentId) });
      if (!comment) return res.status(404).send({ message: "Comment not found" });
      if (comment.userEmail !== email) return res.status(403).send({ message: "Not allowed" });

      await commentsCollection.deleteOne({ _id: new ObjectId(commentId) });
      res.send({ success: true });
    });



    // add lesson 
    app.post("/lessons", async (req, res) => {
      const lesson = req.body;
      lesson.featured = false;
      const result = await lessonsCollection.insertOne(lesson);
      res.send({ success: true, lessonId: result.insertedId });
    });

    // featured update admin manage lesson
    app.patch("/lessons/feature/:id", async (req, res) => {
      const { id } = req.params;
      const { featured } = req.body;

      try {
        const result = await lessonsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { featured } }
        );

        res.send({ success: true });
      } catch (err) {
        res.status(500).send({ error: "Failed to update featured" });
      }
    });


    // update lesson from manage lesson
    app.patch('/lessons/:id', async (req, res) => {
      const { id } = req.params;
      const { title, description, visibility, access } = req.body;

      const lesson = await lessonsCollection.findOne({ _id: new ObjectId(id) })

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

      res.send({ success: true })
    });


    // like unlike
    app.patch("/lessons/like/:id", verifyFBToken, async (req, res) => {
      const lessonId = req.params.id;
      const userEmail = req.decoded_email;

      try {
        const lesson = await lessonsCollection.findOne({ _id: new ObjectId(lessonId) });

        if (!lesson) return res.status(404).send({ message: "Lesson not found" });

        const liked = lesson.likes?.includes(userEmail);

        const update = liked
          ? { $pull: { likes: userEmail }, $inc: { likesCount: -1 } }
          : { $addToSet: { likes: userEmail }, $inc: { likesCount: 1 } };

        await lessonsCollection.updateOne(
          { _id: new ObjectId(lessonId) },
          update
        );

        res.send({
          success: true,
          liked: !liked
        });
      } catch (err) {
        res.status(500).send({ error: "Failed to toggle like" });
      }
    });


    // delete from manage lesson pages
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