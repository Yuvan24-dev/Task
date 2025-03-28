const express = require("express");
const dotenv = require("dotenv");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

dotenv.config();
const app = express();
const port = process.env.PORT || 5000;

app.use(express.json());
app.use(cors({ origin: ["http://localhost:3000"], credentials: true }));
app.use(cookieParser());

const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

app.use("/uploads", express.static("uploads"));

mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
.then(() => console.log("Database connected"))
.catch(err => console.error("Database connection error:", err));


const BioDataSchema = new mongoose.Schema({
    name: { type: String, required: true },
    age: { type: Number, required: true },
    specialization: { type: String, required: true, enum: ['Accounts', 'Biology', 'Mathematics', 'Computer Science'] },
    marks10th: { type: Number, required: true },
    marks12th: { type: Number, required: true },
    certificates: { type: [String], default: [] }
});


const UserSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    username: { type: String, required: true, unique: true },
    phonenumber: { type: String, required: true },
    bioData: { type: BioDataSchema, default: {} }, 
    coursesApplied: [{ type: mongoose.Schema.Types.ObjectId, ref: "Course" }],
    applicationStatus: { type: String, default: "Pending", enum: ["Pending", "Under Review", "Approved", "Rejected"] }
}, { timestamps: true });

const User = mongoose.model("User", UserSchema);

const CourseSchema = new mongoose.Schema({
    name: { type: String, required: true },
    specializationRequired: { type: String, required: true },
    minimumMarks: { type: Number, required: true }
});

const Course = mongoose.model("Course", CourseSchema);

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, "uploads/");
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, "-")}`);
    }
});

const upload = multer({ storage });

const auth = (req, res, next) => {
    try {
        const authHeader = req.headers["authorization"];
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(403).json({ error: "No token provided or incorrect format" });
        }

        const token = authHeader.split(" ")[1];

        jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
            if (err) return res.status(401).json({ error: "Invalid or expired token" });

            req.user = decoded;
            next();
        });
    } catch (error) {
        res.status(500).json({ error: "Failed to authenticate token" });
    }
};


app.post("/signup", async (req, res) => {
    try {
        const { email, password, username, phonenumber } = req.body;

        const existingUser = await User.findOne({ $or: [{ email }, { username }] });
        if (existingUser) return res.status(409).json({ message: "User already exists" });

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ email, password: hashedPassword, username, phonenumber });
        await newUser.save();

        const token = jwt.sign({ id: newUser._id }, process.env.JWT_SECRET, { expiresIn: "1h" });
        res.status(201).json({ message: "Signup successful", token, user: { id: newUser._id } });

    } catch (err) {
        res.status(500).json({ error: "Internal server error" });
    }
});

app.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ error: "User does not exist" });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ error: "Invalid credentials" });

        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "1h" });

        res.json({ message: "Login successful", token, user: { id: user._id } });

    } catch (err) {
        res.status(500).json({ error: "Internal server error" });
    }
});
app.post("/bio", auth, upload.array("certificates"), async (req, res) => {
    try {

        if (!req.body.name || !req.body.age || !req.body.specialization) {
            return res.status(400).json({ error: "Missing required fields" });
        }

        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        user.bioData = {
            name: req.body.name,
            age: Number(req.body.age),
            specialization: req.body.specialization,
            marks10th: Number(req.body.marks10th),
            marks12th: Number(req.body.marks12th),
            certificates: req.files.map((file) => file.filename),
        };


        await user.save();

        res.json({ message: "Bio data uploaded successfully", bioData: user.bioData });

    } catch (err) {
        console.error("Server Error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

app.get("/courses", auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).populate("coursesApplied");

        if (!user || !user.bioData || !user.bioData.specialization) {
            return res.status(400).json({ error: "Please complete your bio data before applying for courses." });
        }
        const courses = await Course.find({
            specializationRequired: user.bioData.specialization, // 
            minimumMarks: { $lte: user.bioData.marks12th }
        });

        res.json({ availableCourses: courses, appliedCourses: user.coursesApplied });

    } catch (err) {
        console.error("Error fetching courses:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});





// Get User Bio Data
app.get("/user", auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        
        if (!user || !user.bioData || !user.bioData.specialization) {
            return res.status(400).json({ error: "Please complete your bio data before applying for courses." });
        }

        const courses = await Course.find({
            specializationRequired: user.bioData.specialization,
            minimumMarks: { $lte: user.bioData.marks12th }
        });

        res.json({ availableCourses: courses, appliedCourses: user.coursesApplied });

    } catch (err) {
        console.error(" Error fetching courses:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});


app.post("/apply/:courseId", auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ error: "User not found" });

        user.coursesApplied.push(req.params.courseId);
        user.applicationStatus = "Under Review";
        await user.save();

        res.json({ message: "Course applied successfully", user });

    } catch (err) {
        res.status(500).json({ error: "Internal server error" });
    }
});

app.post("/apply-course", auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ error: "User not found." });

        const { courseId } = req.body;
        if (!courseId) return res.status(400).json({ error: "Course ID is required." });

        if (user.coursesApplied.includes(courseId)) {
            return res.status(400).json({ error: "You have already applied for this course." });
        }

        user.coursesApplied.push(courseId);
        await user.save();

        res.json({ message: "Application submitted successfully!" });
    } catch (error) {
        console.error("Error applying for course:", error);
        res.status(500).json({ error: "Internal server error." });
    }
});


app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
