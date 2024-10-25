import express, { response } from "express";
import cors from "cors";
//import bodyParser from "body-parser";
import pg from "pg";
import bcrypt, { hash } from "bcrypt";
import dotenv from "dotenv";
import session from "express-session";
import axios from "axios";
import RedisStore from "connect-redis";
import { createClient } from "redis";

const port = 3000;
const saltRounds = 10;
const app = express();
dotenv.config();

app.use(
  cors({
    origin: "https://spontaneous-axolotl-120710.netlify.app",
    credentials: true, // allow credentials (cookies)
  })
);

app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', 'https://spontaneous-axolotl-120710.netlify.app');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.sendStatus(204); // No Content
});

const redisClient = createClient({
  url: process.env.REDIS_URL,
  legacyMode: true
});
redisClient.connect().catch(console.error);

app.use(
  session({
    store: new RedisStore({ client : redisClient}),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: true, sameSite : "none", }, // set to false if using http(local env) and not https, else true for prod https
  })
);

app.use(express.urlencoded({ extended: true }));

app.use(express.json());

const db = new pg.Client({
  user: process.env.PG_USER,
  host: process.env.PG_HOST,
  database: process.env.PG_DATABASE,
  password: process.env.PG_PASSWORD,
  port: process.env.PG_PORT,
});

db.connect();

app.post("/register", async (req, res) => {
  const { userName, enteredPassword } = req.body;
  try {
    const alreadyRegistered = await db.query(
      "select * from users where username= $1",
      [userName]
    );

    if (alreadyRegistered.rows.length > 0) {
      res.json({ isRegistered: true });
    } else {
      bcrypt.hash(enteredPassword, saltRounds, async (err, hash) => {
        if (err) {
          console.log("Error hashing password:", err);
        } else {
          const result = await db.query(
            "Insert into users (username, password) values ($1, $2) returning *",
            [userName, hash]
          );
          if (result.rows.length > 0) {
            req.session.userid = result.rows[0].userid; // create current users session after successfull registration
            console.log("User registered with userID:", req.session.userid);
            return res.json({ registerSuccess: true });
          }
        }
      });
    }
  } catch (error) {
    console.log(error);
  }
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  try {
    const result = await db.query("Select * from users where username = $1", [
      username,
    ]);
    if (result.rows.length > 0) {
      const storedHashedPassword = result.rows[0].password;

      bcrypt.compare(password, storedHashedPassword, (err, same) => {
        if (same) {
          req.session.userid = result.rows[0].userid; // store the userid for session verification
          return res.json({ success: true }); // return success as true to frontend
        } else {
          res.status(401).json({ success: false }); // return success as false to frontend
        }
      });
    } else {
      res.status(401).json({ success: false }); // return success as false for user not found
    }
  } catch (e) {
    console.log("Unable to intiate login:", e);
  }
});

app.post("/resetUnamePwd", async (req, res) => {
  const userID = req.session.userid;
  const { username, password, existingPassword } = req.body;

  if(username !== undefined && password === undefined){
    try {
      const result = await db.query(
        "update users set username=$1 where userid=$2;",
        [username, userID]
      );
      if (result.rowCount > 0) {
        console.log(`Updated username for user: ${userID}`);
        res.json({ usernameUpdated: true });
      }
    } catch (err) {
      console.log(
        `Error in contacting db for username update of user: ${userID}`
      );
    }
  } else if(username !== undefined && password !== undefined) {
    bcrypt.compare(password, existingPassword, async (err, same) => {
      if(same){
        // if password is same then
        res.json({ usernamePasswordUpdated : false});
      } else {
        // if password is not same then
        bcrypt.hash(password, saltRounds, async(err, hash) => {
          if (err) {
            console.log("Error hashing password:", err);
          } else {
            const result = await db.query(
              "update users set username=$1, password=$2 where userid=$3;",
              [username, hash, userID]
            );
            if (result.rowCount > 0) {
              console.log(`Updated username and password for user: ${userID}`);
              res.json({ usernamePasswordUpdated : true });
            }
          }
        });
      }
    });

  } else if (username === undefined && password !== undefined){
    bcrypt.compare(password, existingPassword, async (err, same) => {
      if(same){
        // if password is same then
        res.json({ passwordUpdated : false});
      } else {
        // if password is not same then
        bcrypt.hash(password, saltRounds, async(err, hash) => {
          if (err) {
            console.log("Error hashing password:", err);
          } else {
            const result = await db.query(
              "update users set password=$1 where userid=$2;",
              [hash, userID]
            );
            if (result.rowCount > 0) {
              console.log(`Updated username and password for user: ${userID}`);
              res.json({ passwordUpdated : true });
            }
          }
        });
      }
    });
  }
});

app.post("/details", async (req, res) => {
  console.log("saving details for user:", req.session.userid);
  const userID = req.session.userid; // get the current user
  const { firstName, lastName, insurerCode } = req.body;

  try {
    const result = await db.query(
      "update users set fname=$1, lname=$2, user_plan_code=$3 where userid=$4;",
      [firstName, lastName, insurerCode, userID]
    );

    if (result.rowCount > 0) {
      res.json({ saved: true });
    }
  } catch (err) {
    console.log("Error savings details", err);
  }
});

app.post("/saveAddressDetails", async (req, res) => {
  console.log(
    "Saving user latitude, longitute and address recieved from frontend."
  );
  const userID = req.session.userid;
  const { latitude, longitude, readableAddress } = req.body;

  try {
    const result = await db.query(
      "update users set userlat=$1, userlong=$2, user_address=$3 where userid=$4;",
      [latitude, longitude, readableAddress, userID]
    );

    if (result.rowCount > 0) {
      res.json({ addrStored: true });
    }
  } catch (err) {
    res.json({ addrStored: false });
    console.log("Error saving user address details:", err);
  }
});

app.post("/doctorsBySpeciality", async (req, res) => {
  const userChosenSpeciality = req.body.chosenSpeciality;
  try {
    const result = await db.query(
      "select * from doctors where doc_speciality=$1;",
      [userChosenSpeciality]
    );
    if (result.rowCount > 0) {
      res.json({ filteredDoctorsArray: result.rows });
    } else {
      res.json({ noDocsFound: true });
    }
  } catch (err) {
    console.log("Error fetching filtered doctors data:", err);
  }
});

app.get("/logout", (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get("/getDetails", async (req, res) => {
  if (req.session.userid) {
    try {
      const response = await db.query("select * from users where userid=$1;", [
        req.session.userid,
      ]);
      res.json(response.rows[0]);
      console.log("User details fetched");
    } catch (err) {
      res.json({ errorMessage: "Could not fetch user details" });
    }
  }
});

app.get("/api/autocomplete", async (req, res) => {
  const { input, placeID } = req.query; // destructuring params object for input and placeID property
  const apiKey = process.env.GOOGLE_CLOUD_API_KEY;
  if (input) {
    // if req comes with input address data, call for suggestions
    try {
      const response = await axios.get(
        "https://maps.googleapis.com/maps/api/place/autocomplete/json",
        {
          params: {
            input: input,
            key: apiKey,
          },
        }
      );
      if (response.data.status === "OK") {
        console.log("called places api and got suggestions data");
        res.json(response.data); // sending back the predictions object (suggestions)
      }
    } catch (err) {
      res.status(500).json({ error: "Error fetching suggestions" });
    }
  } else if (placeID) {
    // if req comes with place_id data, call for lat lng of that place_id
    try {
      const response = await axios.get(
        "https://maps.googleapis.com/maps/api/place/details/json",
        {
          params: {
            place_id: placeID,
            key: apiKey,
          },
        }
      );
      if (response.data.status === "OK") {
        console.log("called places api and got lat lng data");
        res.json(response.data); // sending back result data from api for the place id fed
      }
    } catch (err) {
      res.status(500).json({ error: "Error fetching lat lng from place_id" });
    }
  } else {
    console.log("Neither PlaceID nor input were received");
    res.status(400).json({ error: "PlaceID or input parameter is required" });
  }
});

app.get("/session", (req, res) => {
  if (req.session.userid) {
    console.log("session active with userid", req.session.userid);
    res.json({ sessionActive: true });
  } else {
    res.json({ sessionActive: false });
    console.log("No session active");
  }
});

app.listen(port, () => {
  console.log(`Server started on port no ${port}`);
});
