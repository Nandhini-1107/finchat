const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '465', 10),
    secure: true,
    auth: {
        user: process.env.SMTP_USER,
        pass: (process.env.SMTP_PASS || '').replace(/\s+/g, '')
    },
    debug: true,
    logger: true
});

async function main() {
    const target = 'trainee@idealtechlabs.com';
    console.log(`Sending diagnostic email to: ${target}`);
    
    try {
        const info = await transporter.sendMail({
            from: `"FinChat Governance" <${process.env.SMTP_USER}>`,
            to: target,
            subject: `FinChat Verification Ping - ${new Date().toISOString()}`,
            text: 'Hello Trainee,\n\nThis is a verification test from FinChat.\nPlease reply or check if this lands in your Outlook inbox.',
            html: '<p>Hello Trainee,</p><p>This is a verification test from <strong>FinChat</strong>.</p>'
        });
        
        console.log('--- SMTP RESULT ---');
        console.log('Message ID:', info.messageId);
        console.log('Accepted:', info.accepted);
        console.log('Rejected:', info.rejected);
        console.log('Response:', info.response);
    } catch (err) {
        console.error('--- SMTP ERROR ---', err);
    }
}

main();
