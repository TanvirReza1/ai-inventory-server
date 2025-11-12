const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();

// index.js
const decoded = Buffer.from(
  process.env.FIREBASE_SERVICE_KEY,
  "base64"
).toString("utf8");
const serviceAccount = JSON.parse(decoded);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

async function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).send({ message: "Unauthorized: No token provided" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decodedUser = await admin.auth().verifyIdToken(token);
    req.decodedEmail = decodedUser.email; // ✅ Save user email for later checks
    next();
  } catch (error) {
    console.error("Token verification failed:", error);
    return res.status(403).send({ message: "Forbidden: Invalid token" });
  }
}

const uri = `mongodb+srv://${process.env.DB_NAME}:${process.env.DB_PASS}@cluster0.2q88fqm.mongodb.net/?appName=Cluster0`;

//   middleware
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("AI Model Inventory Server is running...");
});

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    const DB = client.db("AiDb");
    const models = DB.collection("models");
    const purchaseColl = DB.collection("purchasedCollection");

    // post
    app.post("/models", async (req, res) => {
      const newModel = req.body;
      const result = await models.insertOne(newModel);
      console.log(`A document was inserted with the _id: ${result.insertedId}`);
      res.send(result);
    });

    // get
    // ✅ Enhanced GET /models with search & filter support
    app.get("/models", async (req, res) => {
      try {
        const search = req.query.search || "";
        const framework = req.query.framework || "";

        // Build query object dynamically
        const query = {};
        if (search) query.name = { $regex: search, $options: "i" }; // case-insensitive search
        if (framework) query.framework = framework;

        const result = await models.find(query).toArray();
        res.send(result);
      } catch (error) {
        console.error("Error fetching filtered models:", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    // GET /models/latest
    app.get("/latest", async (req, res) => {
      try {
        const latestModels = await models
          .find()
          .sort({ createdAt: -1 }) // newest first
          .limit(6)
          .toArray();

        res.send(latestModels);
      } catch (error) {
        res.status(500).send({ message: "Error fetching models", error });
      }
    });

    // GET single model
    app.get("/models/:id", async (req, res) => {
      const id = req.params.id;
      const model = await models.findOne({ _id: new ObjectId(id) });
      res.send(model);
    });

    // POST purchase (add to purchased collection + increase count)
    app.post("/purchase", async (req, res) => {
      const purchase = req.body;
      const result = await purchaseColl.insertOne(purchase);

      // increase purchaseCount in models
      await models.updateOne(
        { _id: new ObjectId(purchase.modelId) },
        { $inc: { purchaseCount: 1 } }
      );

      res.send(result);
    });

    // server.js
    app.get("/models/user/:email", async (req, res) => {
      try {
        const email = req.params.email;

        // Query only models created by this user's email
        const result = await models.find({ createdBy: email }).toArray();

        res.send(result);
      } catch (error) {
        console.error("Error fetching user's models:", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    // DELETE model (only creator can delete)
    app.delete("/models/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const requesterEmail = req.decodedEmail; // ✅ Verified from Firebase token

      try {
        const model = await models.findOne({ _id: new ObjectId(id) });

        if (!model) {
          return res.status(404).send({ message: "Model not found" });
        }

        // ✅ Only the creator can delete
        if (model.createdBy !== requesterEmail) {
          return res.status(403).send({
            message: "Unauthorized: Only creator can delete this model",
          });
        }

        const result = await models.deleteOne({ _id: new ObjectId(id) });
        res.send({
          success: true,
          message: "Model deleted successfully",
          result,
        });
      } catch (error) {
        console.error("Error deleting model:", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    // updateModel
    app.put("/models/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const updatedModel = req.body;
      const requesterEmail = req.decodedEmail; // decoded from Firebase token

      try {
        const existingModel = await models.findOne({ _id: new ObjectId(id) });

        if (!existingModel) {
          return res.status(404).send({ message: "Model not found" });
        }

        // ✅ Check if the logged-in user is the creator
        if (existingModel.createdBy !== requesterEmail) {
          return res
            .status(403)
            .send({ message: "Unauthorized to update this model" });
        }

        // ✅ Perform the update
        const result = await models.updateOne(
          { _id: new ObjectId(id) },
          { $set: updatedModel }
        );

        if (result.modifiedCount > 0) {
          // ✅ Tell frontend to redirect to the updated model details page
          res.send({
            success: true,
            message: "Model updated successfully",
            redirectUrl: `/models/${id}`,
          });
        } else {
          res
            .status(400)
            .send({ message: "No changes were made to the model" });
        }
      } catch (error) {
        console.error("Error updating model:", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    // In your Express server file
    app.get("/purchases/:email", async (req, res) => {
      try {
        const email = req.params.email;
        const purchases = await purchaseColl
          .find({ buyerEmail: email })
          .toArray();
        res.send(purchases);
      } catch (error) {
        console.error("Error fetching purchases:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`server is running on port ${port}`);
});
