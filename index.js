const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
dotenv.config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const app = express();
const admin = require("firebase-admin");
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_KEY);
const port = process.env.PORT || 5000;

app.use(
  cors({
    origin: [
      "https://zapshiftv1.vercel.app",
      "http://localhost:5173"
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  })
);
app.use(express.json());

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

app.get("/", (req, res) => {
  res.send("Hello World!");
});

const { MongoClient, ServerApiVersion } = require("mongodb");
const { log } = require("firebase/firestore/pipelines");
const uri = process.env.DB_URI;
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
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
    //collections are here
    const parcelCollection = client.db("parcelDB").collection("parcels");
    const paymentCollection = client.db("parcelDB").collection("payments");
    const usersCollection = client.db("parcelDB").collection("users");
    const ridersCollection = client.db("parcelDB").collection("riders");
    //custom middleware
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
    //CRUDS are here
    //adding user to db
    app.post("/users", async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existingUser = await usersCollection.findOne(query);

      if (existingUser) {
        return res.send({ message: "User already exists", insertedId: null });
      }

      const result = await usersCollection.insertOne(user);
      res.send(result);
    });
    //adding rider
    app.post("/riders", async (req, res) => {
      const rider = req.body;
      const query = { email: rider.email };
      const existingRider = await ridersCollection.findOne(query);

      if (existingRider) {
        return res.send({ message: "Rider already exists", insertedId: null });
      }

      const result = await ridersCollection.insertOne(rider);
      res.send(result);
    });
    //get riders
    app.get("/riders", async (req, res) => {
      try {
        const { status } = req.query; // get status from query params
        const query = status ? { status } : {}; // if status exists, filter by it

        const cursor = ridersCollection.find(query);
        const result = await cursor.toArray();

        res.send(result);
      } catch (error) {
        console.error("Error fetching riders:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });
    //update rider status
    app.patch("/riders/update/:id", async (req, res) => {
      const id = req.params.id;
      const status = req.body.status;
      const query = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          status: status,
        },
      };
      const result = await ridersCollection.updateOne(query, updateDoc);
      res.send(result);
    });
    //delete rider
    app.delete("/riders/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const deleteRider = await ridersCollection.deleteOne(query);
      res.send(deleteRider);
    });
    //get users
    app.get("/users", verifyFBtoken, async (req, res) => {
      const email = req.query.email;
      // Get the logged-in user from DB
      const loggedInUser = await usersCollection.findOne({
        email: req.decodedUser.email,
      });

      // Check if admin
      const isAdmin = loggedInUser?.role === "admin";

      let query = {};

      if (isAdmin) {
        // Admin can search anything
        query = email ? { email } : {};
      } else {
        // Non-admin can only see their own data
        if (!loggedInUser) {
          return res.status(401).send({ message: "unauthorized" });
        }
        query = { email: req.decodedUser.email };
      }

      const result = await usersCollection.find(query).toArray();
      res.send(result);
    });
    //update user email and
    app.patch("/users", async (req, res) => {
      const email = req.query.email;
      const role = req.body.role;
      const query = { email: email };
      const updateDoc = {
        $set: {
          role: role,
        },
      };
      const result = await usersCollection.updateOne(query, updateDoc);
      res.send(result);
    });
    //update user using put
    app.put("/users", async (req, res) => {
      try {
        const email = req.query.email;
        const updatedData = req.body;

        if (!email) {
          return res.status(400).send({ message: "Email is required" });
        }

        const query = { email: email };

        const updateDoc = {
          $set: updatedData,
        };

        const result = await usersCollection.updateOne(query, updateDoc);

        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal server error" });
      }
    });
    //update user by id
    app.patch("/users/update/:id", verifyFBtoken, async (req, res) => {
      try {
        const id = req.params.id;
        const { role, status } = req.body;

        // 🔐 check admin
        const loggedInUser = await usersCollection.findOne({
          email: req.decodedUser.email,
        });

        if (loggedInUser?.role !== "admin") {
          return res.status(403).send({ message: "forbidden access" });
        }

        // ❗ validate ObjectId
        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid user ID" });
        }

        const query = { _id: new ObjectId(id) };

        // dynamic update (only send what exists)
        const updateFields = {};
        if (role) updateFields.role = role;
        if (status) updateFields.status = status;

        const updateDoc = {
          $set: updateFields,
        };

        const result = await usersCollection.updateOne(query, updateDoc);

        res.send(result);
      } catch (error) {
        console.error("Update user error:", error);
        res.status(500).send({ message: "Failed to update user" });
      }
    });
    //delete single user
    app.delete("/users/:id", verifyFBtoken, async (req, res) => {
      try {
        const id = req.params.id;

        // 🔐 check admin
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
    //delete multiple user
    app.post("/users/delete-many", verifyFBtoken, async (req, res) => {
      try {
        const { ids } = req.body;

        // 🔐 check admin
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
    //get parcels
    app.get("/parcels", async (req, res) => {
      const parcelId = req.query.parcelId;
      const trackingId = req.query.tracking_id;
      const email = req.query.email;
      const query = {};

      if (email) {
        query.created_by = email;
      }

      if (parcelId) {
        if (!ObjectId.isValid(parcelId)) {
          return res.status(400).send({ message: "Invalid parcelId" });
        }
        query._id = new ObjectId(parcelId);
      }

      if (trackingId) {
        query.tracking_id = trackingId;
      }

      const options = {
        sort: { createdAt: -1 },
      };

      try {
        const parcels = await parcelCollection.find(query, options).toArray();
        res.send(parcels);
      } catch (error) {
        res.status(500).send({
          error: "An error occurred while fetching parcels",
        });
      }
    });

    //updating parcel
    app.patch("/parcels", async (req, res) => {
      try {
        const id = req.query.parcelId;
        const { delivery_status } = req.body;

        const query = { _id: new ObjectId(id) };

        const updateDoc = {
          $set: {
            delivery_status: delivery_status,
          },
        };

        const result = await parcelCollection.updateOne(query, updateDoc);

        res.send(result);
      } catch (error) {
        res.status(500).send({ error: "Failed to update status" });
      }
    });
    //adding parcel to db
    app.post("/parcels", async (req, res) => {
      try {
        const newParcel = req.body;
        const addParcel = await parcelCollection.insertOne(newParcel);
        res.send(addParcel);
      } catch (error) {
        console.error("found error while inserting parcel", error);
        res.status(500).send({ message: "failed to create parcel" });
      }
    });
    //deleting parcel from db
    const { ObjectId } = require("mongodb");

    app.delete("/parcels/:id", async (req, res) => {
      const id = req.params.id;

      const query = { _id: new ObjectId(id) }; // convert string to ObjectId
      const deleteParcel = await parcelCollection.deleteOne(query);
      console.log(deleteParcel);

      res.send(deleteParcel);
    });
    //payment intent
    app.post("/create-payment-intent", async (req, res) => {
      const { amount: price } = req.body;

      const amount = parseInt(price * 100);
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });
      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });
    // saving payment history
    app.post("/payments", async (req, res) => {
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

      try {
        // store payment history
        const paymentResult = await paymentCollection.insertOne(paymentDoc);

        // update parcel payment status
        const query = { _id: new ObjectId(payment.parcelId) };

        const updateDoc = {
          $set: {
            payment_status: "paid",
            transactionId: payment.transactionId,
          },
        };

        const updateResult = await parcelCollection.updateOne(query, updateDoc);

        res.send({
          success: true,
          paymentResult,
          updateResult,
        });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Payment failed" });
      }
    });
    //get payments
    app.get("/payments", verifyFBtoken, async (req, res) => {
      const { email, parcelId, transactionId, status } = req.query;
      const query = {};

      if (email) {
        query.email = email;
      }

      if (parcelId) {
        query.parcelId = parcelId;
      }

      if (transactionId) {
        query.transactionId = transactionId;
      }

      if (status) {
        query.payment_status = status;
      }

      try {
        if (req.decodedUser.email !== email) {
          return res.status(403).send({ message: "forbidden access" });
        }
        const payments = await paymentCollection
          .find(query)
          .sort({ created_at: -1 })
          .toArray();

        res.send(payments);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Failed to fetch payments" });
      }
    });
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } finally {
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`app listening on port ${port}`);
});