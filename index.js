const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
dotenv.config();

// FIX 5: Guard FIREBASE_SERVICE_KEY parse — JSON.parse(undefined) throws at startup
let serviceAccount;
try {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_KEY);
} catch (e) {
  console.error("FATAL: FIREBASE_SERVICE_KEY is missing or invalid JSON");
  process.exit(1);
}

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const app = express();
const admin = require("firebase-admin");

// FIX 1: ObjectId imported at the top — not buried inside a route handler
// FIX: MongoClient and ServerApiVersion also moved here cleanly
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

// FIX 2: Removed broken `require("firebase/firestore/pipelines")` — it doesn't exist
// and was crashing the process at boot

const port = process.env.PORT || 5000;

app.use(
  cors({
    origin: [
      "https://zapshiftv1.vercel.app",
      "http://localhost:5173",
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  })
);
app.use(express.json());

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

app.get("/", (req, res) => {
  res.send("Hello World!");
});

const uri = process.env.DB_URI;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();

    // collections
    const parcelCollection = client.db("parcelDB").collection("parcels");
    const paymentCollection = client.db("parcelDB").collection("payments");
    const usersCollection = client.db("parcelDB").collection("users");
    const ridersCollection = client.db("parcelDB").collection("riders");

    // custom middleware
    const verifyFBtoken = async (req, res, next) => {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).send({ message: "unauthorized access" });
      }
      const token = authHeader.split(" ")[1];
      if (!token) {
        return res.status(401).send({ message: "unauthorized access" });
      }
      try {
        const decodedUser = await admin.auth().verifyIdToken(token);
        req.decodedUser = decodedUser;
        next();
      } catch (error) {
        return res.status(403).send({ message: "forbidden access" });
      }
    };

    // ── Users ──────────────────────────────────────────────────────────────────

    // add user
    app.post("/users", async (req, res) => {
      try {
        const user = req.body;
        const query = { email: user.email };
        const existingUser = await usersCollection.findOne(query);
        if (existingUser) {
          return res.send({ message: "User already exists", insertedId: null });
        }
        const result = await usersCollection.insertOne(user);
        res.send(result);
      } catch (error) {
        console.error("Add user error:", error);
        res.status(500).send({ message: "Failed to add user" });
      }
    });

    // get users
    app.get("/users", verifyFBtoken, async (req, res) => {
      try {
        const email = req.query.email;
        const loggedInUser = await usersCollection.findOne({
          email: req.decodedUser.email,
        });
        const isAdmin = loggedInUser?.role === "admin";
        let query = {};
        if (isAdmin) {
          query = email ? { email } : {};
        } else {
          if (!loggedInUser) {
            return res.status(401).send({ message: "unauthorized" });
          }
          query = { email: req.decodedUser.email };
        }
        const result = await usersCollection.find(query).toArray();
        res.send(result);
      } catch (error) {
        console.error("Get users error:", error);
        res.status(500).send({ message: "Failed to fetch users" });
      }
    });

    // update user role (by email)
    app.patch("/users", async (req, res) => {
      try {
        const email = req.query.email;
        const role = req.body.role;
        const query = { email };
        const updateDoc = { $set: { role } };
        const result = await usersCollection.updateOne(query, updateDoc);
        res.send(result);
      } catch (error) {
        console.error("Patch user error:", error);
        res.status(500).send({ message: "Failed to update user" });
      }
    });

    // update user (by email, full body)
    app.put("/users", async (req, res) => {
      try {
        const email = req.query.email;
        const updatedData = req.body;
        if (!email) {
          return res.status(400).send({ message: "Email is required" });
        }
        const query = { email };
        const updateDoc = { $set: updatedData };
        const result = await usersCollection.updateOne(query, updateDoc);
        res.send(result);
      } catch (error) {
        console.error("Put user error:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    // update user by id (admin only)
    app.patch("/users/update/:id", verifyFBtoken, async (req, res) => {
      try {
        const id = req.params.id;
        const { role, status } = req.body;
        const loggedInUser = await usersCollection.findOne({
          email: req.decodedUser.email,
        });
        if (loggedInUser?.role !== "admin") {
          return res.status(403).send({ message: "forbidden access" });
        }
        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid user ID" });
        }
        const query = { _id: new ObjectId(id) };
        const updateFields = {};
        if (role) updateFields.role = role;
        if (status) updateFields.status = status;
        const updateDoc = { $set: updateFields };
        const result = await usersCollection.updateOne(query, updateDoc);
        res.send(result);
      } catch (error) {
        console.error("Update user error:", error);
        res.status(500).send({ message: "Failed to update user" });
      }
    });

    // delete single user (admin only)
    app.delete("/users/:id", verifyFBtoken, async (req, res) => {
      try {
        const id = req.params.id;
        const loggedInUser = await usersCollection.findOne({
          email: req.decodedUser.email,
        });
        if (loggedInUser?.role !== "admin") {
          return res.status(403).send({ message: "forbidden access" });
        }
        const query = { _id: new ObjectId(id) };
        const result = await usersCollection.deleteOne(query);
        res.send(result);
      } catch (error) {
        console.error("Delete user error:", error);
        res.status(500).send({ message: "Failed to delete user" });
      }
    });

    // delete multiple users (admin only)
    app.post("/users/delete-many", verifyFBtoken, async (req, res) => {
      try {
        const { ids } = req.body;
        const loggedInUser = await usersCollection.findOne({
          email: req.decodedUser.email,
        });
        if (loggedInUser?.role !== "admin") {
          return res.status(403).send({ message: "forbidden access" });
        }
        const objectIds = ids.map((id) => new ObjectId(id));
        const result = await usersCollection.deleteMany({
          _id: { $in: objectIds },
        });
        res.send(result);
      } catch (error) {
        console.error("Bulk delete error:", error);
        res.status(500).send({ message: "Failed to delete users" });
      }
    });

    // ── Riders ─────────────────────────────────────────────────────────────────

    // add rider
    app.post("/riders", async (req, res) => {
      try {
        const rider = req.body;
        const query = { email: rider.email };
        const existingRider = await ridersCollection.findOne(query);
        if (existingRider) {
          return res.send({ message: "Rider already exists", insertedId: null });
        }
        const result = await ridersCollection.insertOne(rider);
        res.send(result);
      } catch (error) {
        console.error("Add rider error:", error);
        res.status(500).send({ message: "Failed to add rider" });
      }
    });

    // get riders
    app.get("/riders", async (req, res) => {
      try {
        const { status } = req.query;
        const query = status ? { status } : {};
        const result = await ridersCollection.find(query).toArray();
        res.send(result);
      } catch (error) {
        console.error("Error fetching riders:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // update rider status
    app.patch("/riders/update/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const status = req.body.status;
        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid rider ID" });
        }
        const query = { _id: new ObjectId(id) };
        const updateDoc = { $set: { status } };
        const result = await ridersCollection.updateOne(query, updateDoc);
        res.send(result);
      } catch (error) {
        console.error("Update rider error:", error);
        res.status(500).send({ message: "Failed to update rider" });
      }
    });

    // delete rider
    app.delete("/riders/:id", async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid rider ID" });
        }
        const query = { _id: new ObjectId(id) };
        const result = await ridersCollection.deleteOne(query);
        res.send(result);
      } catch (error) {
        console.error("Delete rider error:", error);
        res.status(500).send({ message: "Failed to delete rider" });
      }
    });

    // ── Parcels ────────────────────────────────────────────────────────────────

    // get parcels
    app.get("/parcels", async (req, res) => {
      try {
        const { parcelId, tracking_id: trackingId, email } = req.query;
        const query = {};
        if (email) query.created_by = email;
        if (parcelId) {
          if (!ObjectId.isValid(parcelId)) {
            return res.status(400).send({ message: "Invalid parcelId" });
          }
          query._id = new ObjectId(parcelId);
        }
        if (trackingId) query.tracking_id = trackingId;
        const parcels = await parcelCollection
          .find(query, { sort: { createdAt: -1 } })
          .toArray();
        res.send(parcels);
      } catch (error) {
        console.error("Get parcels error:", error);
        res.status(500).send({ error: "An error occurred while fetching parcels" });
      }
    });

    // add parcel
    app.post("/parcels", async (req, res) => {
      try {
        const newParcel = req.body;
        const result = await parcelCollection.insertOne(newParcel);
        res.send(result);
      } catch (error) {
        console.error("Insert parcel error:", error);
        res.status(500).send({ message: "failed to create parcel" });
      }
    });

    // update parcel status
    app.patch("/parcels", async (req, res) => {
      try {
        const id = req.query.parcelId;
        const { delivery_status } = req.body;
        if (!id || !ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid parcelId" });
        }
        const query = { _id: new ObjectId(id) };
        const updateDoc = { $set: { delivery_status } };
        const result = await parcelCollection.updateOne(query, updateDoc);
        res.send(result);
      } catch (error) {
        console.error("Update parcel error:", error);
        res.status(500).send({ error: "Failed to update status" });
      }
    });

    // delete parcel
    app.delete("/parcels/:id", async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid parcel ID" });
        }
        const query = { _id: new ObjectId(id) };
        const result = await parcelCollection.deleteOne(query);
        res.send(result);
      } catch (error) {
        console.error("Delete parcel error:", error);
        res.status(500).send({ message: "Failed to delete parcel" });
      }
    });

    // ── Payments ───────────────────────────────────────────────────────────────

    // FIX 3: create payment intent — wrapped in try/catch with input validation
    app.post("/create-payment-intent", async (req, res) => {
      try {
        const { amount: price } = req.body;
        if (!price || isNaN(price)) {
          return res.status(400).send({ message: "Invalid amount" });
        }
        const amount = parseInt(price * 100);
        const paymentIntent = await stripe.paymentIntents.create({
          amount,
          currency: "usd",
          payment_method_types: ["card"],
        });
        res.send({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        console.error("Stripe error:", error);
        res.status(500).send({ message: "Payment intent creation failed" });
      }
    });

    // save payment history
    app.post("/payments", async (req, res) => {
      try {
        const payment = req.body;
        const paymentDoc = {
          parcelId: payment.parcelId,
          email: payment.email,
          name: payment.name,
          amount: payment.amount,
          currency: "usd",
          paymentMethod: "card",
          transactionId: payment.transactionId,
          payment_status: "paid",
          created_at: new Date().toISOString(),
          paid_at: new Date(),
        };
        const paymentResult = await paymentCollection.insertOne(paymentDoc);
        const query = { _id: new ObjectId(payment.parcelId) };
        const updateDoc = {
          $set: {
            payment_status: "paid",
            transactionId: payment.transactionId,
          },
        };
        const updateResult = await parcelCollection.updateOne(query, updateDoc);
        res.send({ success: true, paymentResult, updateResult });
      } catch (error) {
        console.error("Payment save error:", error);
        res.status(500).send({ message: "Payment failed" });
      }
    });

    // FIX 4: get payments — email is required and verified against token before querying
    app.get("/payments", verifyFBtoken, async (req, res) => {
      try {
        const { email, parcelId, transactionId, status } = req.query;

        // Require email param — without it the query returns all payments
        if (!email) {
          return res.status(400).send({ message: "email query param is required" });
        }

        // Verify the requesting user owns this email
        if (req.decodedUser.email !== email) {
          return res.status(403).send({ message: "forbidden access" });
        }

        const query = { email };
        if (parcelId) query.parcelId = parcelId;
        if (transactionId) query.transactionId = transactionId;
        if (status) query.payment_status = status;

        const payments = await paymentCollection
          .find(query)
          .sort({ created_at: -1 })
          .toArray();
        res.send(payments);
      } catch (error) {
        console.error("Get payments error:", error);
        res.status(500).send({ message: "Failed to fetch payments" });
      }
    });

    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // client stays open for the lifetime of the server
  }
}

run().catch(console.dir);

// Works locally AND on Vercel
if (process.env.NODE_ENV !== "production") {
  app.listen(port, () => {
    console.log(`app listening on port ${port}`);
  });
}

module.exports = app;