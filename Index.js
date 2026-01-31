const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

// Environment variables
const BOT_TOKEN = process.env.BOT_TOKEN;
const USDT_TRC20 = process.env.USDT_TRC20;
const USDT_BEP20 = process.env.USDT_BEP20;
const MONGODB_URI = process.env.MONGODB_URI;
const ADMIN_USER_ID = process.env.ADMIN_USER_ID;
const PORT = process.env.PORT || 3000;

// Validate critical environment variables
if (!BOT_TOKEN) {
    console.error('ERROR: BOT_TOKEN is not set!');
    process.exit(1);
}

if (!USDT_TRC20) {
    console.error('ERROR: USDT_TRC20 wallet address is not set!');
    process.exit(1);
}

if (!USDT_BEP20) {
    console.error('ERROR: USDT_BEP20 wallet address is not set!');
    process.exit(1);
}

if (!MONGODB_URI) {
    console.error('ERROR: MONGODB_URI is not set!');
    process.exit(1);
}

if (!ADMIN_USER_ID) {
    console.error('WARNING: ADMIN_USER_ID is not set! You won\'t be able to upload coffee image.');
}

// MongoDB Schemas
const userSchema = new mongoose.Schema({
    userId: { type: Number, required: true, unique: true },
    username: { type: String, default: null },
    firstName: { type: String, default: null },
    lastName: { type: String, default: null },
    languageCode: { type: String, default: null },
    isBot: { type: Boolean, default: false },
    isPremium: { type: Boolean, default: false },
    firstSeen: { type: Date, default: Date.now },
    lastActive: { type: Date, default: Date.now },
    totalInteractions: { type: Number, default: 1 },
    donateViews: { type: Number, default: 0 }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);

// Connect to MongoDB
mongoose.connect(MONGODB_URI)
    .then(() => console.log('✅ Connected to MongoDB'))
    .catch(err => {
        console.error('❌ MongoDB connection error:', err);
        process.exit(1);
    });

// Function to save/update user data
async function saveUserData(msg, action = 'start') {
    try {
        const user = msg.from;
        const userId = user.id;

        let userData = await User.findOne({ userId });

        if (userData) {
            // Update existing user
            userData.username = user.username || null;
            userData.firstName = user.first_name || null;
            userData.lastName = user.last_name || null;
            userData.languageCode = user.language_code || null;
            userData.isPremium = user.is_premium || false;
            userData.lastActive = new Date();
            userData.totalInteractions += 1;
            
            if (action === 'donate') {
                userData.donateViews += 1;
            }
            
            await userData.save();
            console.log(`📝 Updated user: ${userId} - Action: ${action}`);
        } else {
            // Create new user
            userData = new User({
                userId,
                username: user.username || null,
                firstName: user.first_name || null,
                lastName: user.last_name || null,
                languageCode: user.language_code || null,
                isBot: user.is_bot || false,
                isPremium: user.is_premium || false,
                donateViews: action === 'donate' ? 1 : 0
            });
            
            await userData.save();
            console.log(`✨ New user saved: ${userId} - Action: ${action}`);
        }

        return userData;
    } catch (error) {
        console.error('❌ Error saving user data:', error);
    }
}

// Initialize Express app
const app = express();
app.use(express.json());

// Initialize bot with polling
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

console.log('🤖 Bot started with polling mode');

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        bot: 'BuyWallSwipeCoffeeBot Active'
    });
});

// Root endpoint
app.get('/', (req, res) => {
    res.status(200).send('☕ BuyWallSwipeCoffeeBot is running!');
});

// Debug endpoint to check bot status
app.get('/bot-info', async (req, res) => {
    try {
        const me = await bot.getMe();
        res.json({
            status: 'Bot is running',
            mode: 'polling',
            bot: me,
            uptime: process.uptime()
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Handle /start command
bot.onText(/\/start(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const startParam = match[1].trim();
    
    console.log(`📨 /start command received from ${chatId}, param: ${startParam}`);
    
    // Track user
    await saveUserData(msg, startParam === 'Donate' ? 'donate' : 'start');
    
    // If start parameter is "Donate", show donate message
    if (startParam === 'Donate') {
        await sendDonateMessage(chatId);
        return;
    }
    
    // Default start message
    const welcomeText = 
        '☕ <b>Buy WallSwipe a Coffee</b>\n\n' +
        'If you enjoy WallSwipe and want to support the project,\n' +
        'you can buy us a coffee using crypto.\n\n' +
        'Your support helps us keep things running 🚀\n\n' +
        'Type /donate to see wallet addresses.';
    
    // Send message
    try {
        await bot.sendMessage(chatId, welcomeText, {
            parse_mode: 'HTML'
        });
        console.log(`✅ Welcome message sent to ${chatId}`);
    } catch (error) {
        console.error('❌ Error sending message:', error);
    }
});

// Handle /donate command
bot.onText(/\/donate/, async (msg) => {
    const chatId = msg.chat.id;
    console.log(`📨 /donate command received from ${chatId}`);
    
    // Track user
    await saveUserData(msg, 'donate');
    
    await sendDonateMessage(chatId);
});

// Handle photo uploads (admin only - for coffee image)
bot.on('photo', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // Check if user is admin
    if (!ADMIN_USER_ID || userId.toString() !== ADMIN_USER_ID) {
        return; // Silently ignore photos from non-admins
    }
    
    try {
        const photo = msg.photo[msg.photo.length - 1]; // Get highest quality photo
        const fileId = photo.file_id;
        
        // Download the photo
        const file = await bot.getFile(fileId);
        const filePath = file.file_path;
        const downloadUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
        
        // Download and save as coffee.jpg
        const https = require('https');
        const imageStream = fs.createWriteStream(path.join(__dirname, 'coffee.jpg'));
        
        https.get(downloadUrl, (response) => {
            response.pipe(imageStream);
            imageStream.on('finish', async () => {
                imageStream.close();
                await bot.sendMessage(chatId, '✅ Coffee image updated successfully!');
                console.log('📷 Coffee image updated by admin');
            });
        });
    } catch (error) {
        console.error('❌ Error saving photo:', error);
        await bot.sendMessage(chatId, '❌ Error saving image. Please try again.');
    }
});

// Admin command: /stats - Get bot statistics
bot.onText(/\/stats/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    // Check if user is admin
    if (!ADMIN_USER_ID || userId.toString() !== ADMIN_USER_ID) {
        return; // Silently ignore for non-admins
    }

    try {
        const totalUsers = await User.countDocuments();
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const newUsersToday = await User.countDocuments({
            firstSeen: { $gte: today }
        });

        const last7Days = new Date();
        last7Days.setDate(last7Days.getDate() - 7);
        const newUsersWeek = await User.countDocuments({
            firstSeen: { $gte: last7Days }
        });

        const totalDonateViews = await User.aggregate([
            { $group: { _id: null, total: { $sum: '$donateViews' } } }
        ]);

        const donateViewsCount = totalDonateViews.length > 0 ? totalDonateViews[0].total : 0;

        const premiumUsers = await User.countDocuments({ isPremium: true });

        const message = 
            `📊 <b>Bot Statistics</b>\n\n` +
            `👥 <b>Total Users:</b> ${totalUsers}\n` +
            `✨ <b>New Today:</b> ${newUsersToday}\n` +
            `📅 <b>New This Week:</b> ${newUsersWeek}\n` +
            `💎 <b>Premium Users:</b> ${premiumUsers}\n` +
            `☕ <b>Donate Page Views:</b> ${donateViewsCount}\n\n` +
            `🕐 <b>Generated:</b> ${new Date().toLocaleString()}`;

        await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
    } catch (error) {
        console.error('❌ Error fetching stats:', error);
        await bot.sendMessage(chatId, '❌ Error fetching statistics.');
    }
});

// Function to send donate message with image
async function sendDonateMessage(chatId) {
    const donateText = 
        '☕ <b>Support WallSwipe</b>\n\n' +
        'You can support us by making a crypto donation:\n\n' +
        '🔹 <b>USDT [TRC20]</b> (click to copy)\n' +
        `<code>${USDT_TRC20}</code>\n\n` +
        '🔹 <b>USDT [BEP20]</b> (click to copy)\n' +
        `<code>${USDT_BEP20}</code>\n\n` +
        '⚠️ Please send only USDT on the selected network.\n' +
        'Crypto transactions are irreversible.\n\n' +
        'Thank you for supporting WallSwipe ❤️';
    
    try {
        // Check if coffee image exists
        const imagePath = path.join(__dirname, 'coffee.jpg');
        
        if (fs.existsSync(imagePath)) {
            // Send with image
            await bot.sendPhoto(chatId, imagePath, {
                caption: donateText,
                parse_mode: 'HTML'
            });
            console.log(`✅ Donate message with image sent to ${chatId}`);
        } else {
            // Send without image
            await bot.sendMessage(chatId, donateText, {
                parse_mode: 'HTML'
            });
            console.log(`✅ Donate message (no image) sent to ${chatId}`);
        }
    } catch (error) {
        console.error('❌ Error sending donate message:', error);
    }
}

// Error handling
bot.on('polling_error', (error) => {
    console.error('Polling error:', error);
});

bot.on('webhook_error', (error) => {
    console.error('Webhook error:', error);
});

// Start Express server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server is running on port ${PORT}`);
    console.log(`🤖 Bot running in POLLING mode`);
    console.log(`🤖 Bot token: ${BOT_TOKEN.substring(0, 10)}...`);
    console.log(`💰 USDT TRC20: ${USDT_TRC20}`);
    console.log(`💰 USDT BEP20: ${USDT_BEP20}`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down gracefully...');
    await mongoose.connection.close();
    bot.close();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n🛑 Shutting down gracefully...');
    await mongoose.connection.close();
    bot.close();
    process.exit(0);
});
