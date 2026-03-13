const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
dotenv.config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const app = express();
const admin = require("firebase-admin");
const serviceAccount = require("./fbPrivateKey.json");
const port = process.env.PORT || 5000;

app.use(
  cors({
    origin: "*",
  }),
);
app.use(express.json());

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});


app.get("/", (req, res) => {
  res.send("Hello World!");
});

const { MongoClient, ServerApiVersion } = require("mongodb");
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
    //custom middleware
    const verifyFBtoken = async(req, res, next) =>{
      const authHeader = req.headers.authorization;
      if(!authHeader){
        return res.status(401).send({message: 'unauthorized access'})
      }
      const token = authHeader.split(' ')[1];
      if(!token){
        return res.status(401).send({message: 'unauthorized access'})
      }
    }
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
    //get users
    app.get("/users", async (req, res) => {
      const cursor = usersCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    });
    app.get("/parcels", async (req, res) => {
      const email = req.query.email;
      const parcelId = req.query.parcelId;

      // Build query based on the provided parameters
      const query = {};

      if (email) {
        query.created_by = email;
      }

      if (parcelId) {
        query._id = new ObjectId(parcelId); // Assuming _id is the field for parcelId
      }

      const options = {
        sort: { createdAt: -1 },
      };

      try {
        const parcels = await parcelCollection.find(query, options).toArray();
        res.send(parcels);
      } catch (error) {
        res
          .status(500)
          .send({ error: "An error occurred while fetching parcels" });
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
    app.get("/payments",verifyFBtoken, async (req, res) => {
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
  console.log(`Example app listening on port ${port}`);
});
