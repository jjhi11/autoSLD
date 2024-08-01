const {onRequest} = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");


const functions = require('firebase-functions');
const fetch = require('node-fetch');
const cors = require('cors')({
    origin: 'https://ut-dnr-ugs-styling-prod.web.app' // Allow requests from your frontend
});
const JSZip = require('jszip'); // For handling ZIP files

exports.convertLyrx = functions.https.onRequest((request, response) => {
    if (request.method === 'OPTIONS') {
        // Handle preflight request
        cors(request, response, () => {
            response.status(204).send(''); // Send an empty response
        });
        return; // Exit early
    }

    // Check if the user is authenticated
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',   
 
            'The function must be called while authenticated.'   

        );
    }
    cors(request, response, async () => { 
        try {
            const cloudRunUrl = 'https://lyrx2sld-kwkppwa7oq-uc.a.run.app/v1/lyrx2sld/';
            const lyrxFileData = request.rawBody; 
            const cloudRunResponse = await fetch(cloudRunUrl, {
                method: 'POST',
                body: lyrxFileData, 
                headers: { 'Content-Type': 'application/json' }
            });

            if (!cloudRunResponse.ok) {
                throw new Error(`Cloud Run error: ${cloudRunResponse.statusText}`);
            }

            const zipData = await cloudRunResponse.buffer(); 

            // 1. Extract SLD from ZIP
            const zip = await JSZip.loadAsync(zipData);
            const sldFile = Object.values(zip.files).find(file => file.name.endsWith('.sld'));
            const sldContent = await sldFile.async('string');

            // 2. GeoServer Integration
            const geoserverUrl = 'https://geoserver225-ffmu3lsepa-uc.a.run.app/geoserver/web'; // Replace with your GeoServer URL
            // Retrieve secrets from Google Cloud Secret Manager
            const geoserverUsername = await accessSecret(
                'projects/ut-dnr-ugs-styling-prod/secrets/GEOSERVER_USERNAME/versions/latest',
              );
              const geoserverPassword = await accessSecret(
                'projects/ut-dnr-ugs-styling-prod/secrets/GEOSERVER_PASSWORD/versions/latest',
              );
            const layerName = request.body.layerName; // Get layerName
            const sldName = request.body.sldName;     // Get sldName

            const options = {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/vnd.ogc.sld+xml',
                    'Authorization': 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64')
                },
                body: sldContent
            };

            const styleUploadResponse = await fetch(`${geoserverUrl}/rest/styles/${sldName}`, options);
            if (!styleUploadResponse.ok) {
                throw new Error(`GeoServer error (style upload): ${styleUploadResponse.statusText}`);
            }

            const styleApplyResponse = await fetch(`${geoserverUrl}/rest/layers/${layerName}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64')
                },
                body: JSON.stringify({ layer: { defaultStyle: { name: sldName } } })
            });
            if (!styleApplyResponse.ok) {
                throw new Error(`GeoServer error (style apply): ${styleApplyResponse.statusText}`);
            }

            // 3. Send success response
            response.status(200).send("Conversion and GeoServer upload successful!");

            console.log('Request headers:', request.headers); // Add logging
            console.log('Response headers:', response.headers); // Add logging

        } catch (error) {
            console.error('Error:', error); // Add logging
            response.status(500).send({ error: error.message });
            console.error("Error converting .lyrx or uploading to GeoServer:", error);
            statusDiv.textContent = `An error occurred during conversion: ${error.message}`
            response.status(500).send("Error in the process.");
        }
    }); 
});
