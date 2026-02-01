const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const mongoose = require('mongoose');

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

const coffeeImageSchema = new mongoose.Schema({
    fileId: { type: String, required: true },
    uploadedBy: { type: Number, required: true },
    uploadedAt: { type: Date, default: Date.now }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);
const CoffeeImage = mongoose.model('CoffeeImage', coffeeImageSchema);

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
            // Update existing user - don't increment anything for duplicates
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
            console.log(`📝 Updated user: ${userId} (${user.username || 'no username'}) - Action: ${action}`);
        } else {
            // Create new user - only count as new user once
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
            console.log(`✨ New user saved: ${userId} (${user.username || 'no username'}) - Action: ${action}`);
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
        
        // Save file_id to database
        const coffeeImage = new CoffeeImage({
            fileId: fileId,
            uploadedBy: userId
        });
        
        await coffeeImage.save();
        
        await bot.sendMessage(chatId, '✅ Coffee image updated successfully! The image will now be used in /donate command.');
        console.log(`📷 Coffee image updated by admin (User ID: ${userId})`);
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

// Admin command: /users - Get list of all users
bot.onText(/\/users(?:\s+(\d+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const page = parseInt(match[1]) || 1;
    const perPage = 20;

    // Check if user is admin
    if (!ADMIN_USER_ID || userId.toString() !== ADMIN_USER_ID) {
        return; // Silently ignore for non-admins
    }

    try {
        const totalUsers = await User.countDocuments();
        const totalPages = Math.ceil(totalUsers / perPage);
        const skip = (page - 1) * perPage;

        const users = await User.find()
            .sort({ firstSeen: -1 })
            .skip(skip)
            .limit(perPage);

        if (users.length === 0) {
            await bot.sendMessage(chatId, '📊 No users found.');
            return;
        }

        let message = `👥 <b>Users List (Page ${page}/${totalPages})</b>\n`;
        message += `<b>Total Users:</b> ${totalUsers}\n\n`;
        
        users.forEach((user, index) => {
            const num = skip + index + 1;
            const username = user.username ? `@${user.username}` : 'No username';
            const name = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'No name';
            const premium = user.isPremium ? '💎' : '';
            
            message += `${num}. ${name} ${premium}\n`;
            message += `   👤 ${username}\n`;
            message += `   🆔 <code>${user.userId}</code>\n`;
            message += `   📅 ${user.firstSeen.toLocaleDateString()}\n`;
            message += `   💬 Interactions: ${user.totalInteractions} | ☕ Views: ${user.donateViews}\n\n`;
        });

        if (totalPages > 1) {
            message += `\n📄 Use /users ${page + 1} for next page`;
        }

        await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
    } catch (error) {
        console.error('❌ Error fetching users:', error);
        await bot.sendMessage(chatId, '❌ Error fetching users list.');
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
        // Get coffee image from database
        const coffeeImage = await CoffeeImage.findOne().sort({ uploadedAt: -1 });
        
        if (coffeeImage && coffeeImage.fileId) {
            // Send with image using file_id from database
            await bot.sendPhoto(chatId, coffeeImage.fileId, {
                caption: donateText,
                parse_mode: 'HTML'
            });
            console.log(`✅ Donate message with image sent to ${chatId}`);
        } else {
            // Send without image if no image in database
            await bot.sendMessage(chatId, donateText, {
                parse_mode: 'HTML'
            });
            console.log(`✅ Donate message (no image) sent to ${chatId}`);
        }
    } catch (error) {
        console.error('❌ Error sending donate message:', error);
        // Fallback to text only if image fails
        try {
            await bot.sendMessage(chatId, donateText, {
                parse_mode: 'HTML'
            });
        } catch (err) {
            console.error('❌ Error sending fallback message:', err);
        }
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
