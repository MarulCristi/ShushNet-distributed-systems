const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    await mongoose.connect('mongodb://localhost:27017/shush-net');
    console.log('Connected to MongoDB');
  } catch (error) {
    console.error('Connection failed:', error);
    process.exit(1);
  }
};

const cleanup = async () => {
  await connectDB();
  
  await mongoose.connection.collection('apartments').deleteMany({});
  await mongoose.connection.collection('complaints').deleteMany({});
  await mongoose.connection.collection('strikes').deleteMany({});
  
  console.log('✓ Collections cleared');
  
  // Also drop indexes
  try {
    await mongoose.connection.collection('apartments').dropIndexes();
    console.log('✓ Indexes dropped');
  } catch (e) {
    console.log('Index drop skipped');
  }
  
  await mongoose.disconnect();
};

cleanup();
