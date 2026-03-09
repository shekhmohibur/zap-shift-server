const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
dotenv.config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const app = express();
const port = process.env.PORT || 5000;

app.use(
  cors({
    origin: "*",
  }),
);
app.use(express.json());

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

    //CRUDS are here
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
    app.post("/create-payment-intent", async (req, res) => {
      const { amount:price } = req.body;

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
