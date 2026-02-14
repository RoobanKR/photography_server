import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";

dotenv.config();

const seedUsers = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Connected to MongoDB");

    const adminUsers = [
      {
        email: "suryaadmin@gmail.com",
        password: "123",
        name: "Surya Admin",
        role: "admin",
        clientId: "11111111111111"
      },
      {
        email: "admin@example.com",
        password: "admin123",
        name: "System Administrator",
        role: "admin",
        clientId: "2222222222222222222"
      },
      {
        email: "superadmin@company.com",
        password: "superadmin@2024",
        name: "Super Admin",
        role: "admin",
        clientId: "33333333333333333"
      },
      {
        email: "techadmin@gmail.com",
        password: "TechAdmin#123",
        name: "Technical Admin",
        role: "admin",
        clientId: "4444444444444444"
      },
      {
        email: "operations@admin.com",
        password: "OpsAdmin2024!",
        name: "Operations Admin",
        role: "admin",
        clientId: "5555555555555555"
      }
    ];

    const createdUsers = [];

    for (const userData of adminUsers) {
      // Check if user already exists
      const existingUser = await mongoose.connection.db.collection('users').findOne({ 
        $or: [
          { email: userData.email },
          { clientId: userData.clientId }
        ]
      });
      
      if (existingUser) {
        console.log(`ℹ️  User with email ${userData.email} or clientId ${userData.clientId} already exists`);
        continue;
      }

      // Hash the password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(userData.password, salt);

      // Create new user
      const result = await mongoose.connection.db.collection('users').insertOne({
        email: userData.email,
        password: hashedPassword,
        name: userData.name,
        role: userData.role,
        clientId: userData.clientId,
        createdAt: new Date()
      });

      createdUsers.push({
        id: result.insertedId,
        email: userData.email,
        name: userData.name,
        role: userData.role,
        clientId: userData.clientId
      });

      console.log(`✅ User ${userData.email} created successfully with clientId: ${userData.clientId}`);
    }

    // Summary
    console.log("\n📊 SEEDING SUMMARY:");
    console.log("==================");
    console.log(`Total users in seed data: ${adminUsers.length}`);
    console.log(`Created: ${createdUsers.length}`);
    console.log(`Skipped (already exists): ${adminUsers.length - createdUsers.length}`);
    
    if (createdUsers.length > 0) {
      console.log("\n👥 Created Users:");
      createdUsers.forEach(user => {
        console.log(`- ${user.name} (${user.email}) - Role: ${user.role} - ClientID: ${user.clientId}`);
      });
    }

    console.log("\n🔑 Login Credentials:");
    console.log("====================");
    adminUsers.forEach(user => {
      console.log(`Email: ${user.email}`);
      console.log(`Password: ${user.password}`);
      console.log(`ClientID: ${user.clientId}`);
      console.log("---");
    });

    await mongoose.disconnect();
    console.log("\n✅ Disconnected from MongoDB");
  } catch (error) {
    console.error("❌ Error seeding users:", error);
    process.exit(1);
  }
};

seedUsers();