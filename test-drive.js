require('dotenv').config();
const { google } = require('googleapis');

// YOUR FOLDER ID
const FOLDER_ID = '1bB6-3-q62cn2mfRZ9pfMl72M75_yZMp1';

async function testConnection() {
    console.log("1. Reading Credentials...");
    
    let credentials;
    try {
        const jsonContent = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
        if (!jsonContent) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is empty in .env");
        credentials = JSON.parse(jsonContent);
        console.log("   ✅ Credentials found for:", credentials.client_email);
    } catch (error) {
        console.error("   ❌ FAILED to read .env file.");
        console.error("   Reason:", error.message);
        console.error("   TIP: Make sure the JSON is on ONE SINGLE LINE in .env");
        return;
    }

    console.log("\n2. Connecting to Google Drive...");
    try {
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/drive.readonly'],
        });
        const drive = google.drive({ version: 'v3', auth });

        console.log(`   Attempting to open folder: ${FOLDER_ID}`);
        
        const response = await drive.files.list({
            q: `'${FOLDER_ID}' in parents`,
            pageSize: 5,
            fields: 'files(id, name)'
        });

        console.log("\n3. RESULT:");
        if (response.data.files.length === 0) {
            console.log("   ⚠️  Connection Successful, BUT folder is empty.");
        } else {
            console.log("   ✅ SUCCESS! Found files:");
            response.data.files.forEach(f => console.log(`   - ${f.name}`));
        }

    } catch (error) {
        console.error("\n❌ CONNECTION FAILED");
        console.error("   Error Message:", error.message);
        
        if (error.message.includes("invalid_grant")) {
            console.log("\n   👉 CAUSE: Your Private Key is broken.");
            console.log("   FIX: Re-download the JSON key from Google Cloud and paste it again.");
        }
        if (error.message.includes("File not found")) {
            console.log("\n   👉 CAUSE: The Service Account cannot see the folder.");
            console.log("   FIX: Share the folder again with the client_email found in step 1.");
        }
        if (error.message.includes("Drive API has not been used")) {
            console.log("\n   👉 CAUSE: API is disabled.");
            console.log("   FIX: Go to Google Cloud Console > APIs & Services > Enable 'Google Drive API'.");
        }
    }
}

testConnection();