/**
 * Firebase Functions for EU2K Hub
 * Gemini AI Proxy - API key stored securely in Cloud Function
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const { GoogleGenAI } = require("@google/genai");

// Define secret for Gemini API key - stored in Firebase Secrets Manager
const geminiApiKey = defineSecret("GEMINI_API_KEY");

// Brand names that should never be translated
const BRAND_NAMES = [
  'EU2K Hub', 'Hub', 'DÖK', 'Devs', 'YouHub', 'Hive', 'EU2K',
  'Európa 2000', 'Európa 2000 Gimnázium', 'Event Hub', 'Food Hub', 
  'Fitness Hub', 'QR-Kód', 'OkosDoboz', 'Microsoft'
];

// System instruction for translations
const TRANSLATION_SYSTEM_INSTRUCTION = `You are a translation assistant for a school application called EU2K Hub.

CRITICAL RULES:
1. NEVER translate these brand names - keep them exactly as they appear:
   ${BRAND_NAMES.join(', ')}
   
2. Keep "QR-Kód" with the hyphen in all languages.

3. When translating, maintain the original tone and formality level.

4. For JSON input, return ONLY valid JSON output with the same structure.

5. Do NOT add any explanation, commentary, or markdown formatting.

6. If the input is already in the target language, return it unchanged.

7. Preserve any HTML tags, emojis, or special formatting in the text.`;

// Global rate limiting configuration (failsafe for ALL functions)
const RATE_LIMIT_REQUESTS_PER_MINUTE = 30;
const RATE_LIMIT_MIN_INTERVAL_MS = 100;
const RATE_LIMIT_BURST = 3;

// Initialize Firestore
const { getFirestore } = require("firebase-admin/firestore");
const db = getFirestore();

/**
 * Global rate limiting helper (failsafe for ALL functions)
 */
async function checkGlobalRateLimit(userId, functionName = 'unknown') {
  const rlRef = db.doc(`rateLimits/${userId}`);
  const rlSnap = await rlRef.get();
  const now = Date.now();

  if (rlSnap.exists) {
    const data = rlSnap.data();
    const lastRequestTime = data.lastRequestTime?.toMillis() || 0;
    const requestTimes = data.requestTimes || [];

    if (now - lastRequestTime < RATE_LIMIT_MIN_INTERVAL_MS) {
      const recentRequests = requestTimes.filter((time) => time > now - 1000);
      if (recentRequests.length >= RATE_LIMIT_BURST) {
        throw new HttpsError('resource-exhausted', 'Túl gyakori kérések. Várj egy kicsit.');
      }
    }

    const oneMinuteAgo = now - 60 * 1000;
    const recentRequests = requestTimes.filter((time) => time > oneMinuteAgo);

    if (recentRequests.length >= RATE_LIMIT_REQUESTS_PER_MINUTE) {
      throw new HttpsError('resource-exhausted', 'Túl sok kérés rövid idő alatt. Próbáld újra később.');
    }

    const { Timestamp } = require("firebase-admin/firestore");
    const updatedRequestTimes = [...recentRequests, now].slice(-RATE_LIMIT_REQUESTS_PER_MINUTE);
    await rlRef.update({
      lastRequestTime: Timestamp.fromMillis(now),
      requestTimes: updatedRequestTimes,
      lastFunction: functionName
    });
  } else {
    const { Timestamp } = require("firebase-admin/firestore");
    await rlRef.set({
      lastRequestTime: Timestamp.fromMillis(now),
      requestTimes: [now],
      lastFunction: functionName,
      attempts: 0,
      windowStart: null,
      lockedUntil: null
    });
  }
}

/**
 * Cloud Function to generate content using Gemini AI
 * The API key is stored securely in the Cloud Function and never exposed to clients
 */
exports.generateContent = onCall(
  {
    region: "europe-west1",
    secrets: [geminiApiKey],
    enforceAppCheck: false,
  },
  async (request) => {
    try {
      // Global rate limiting (failsafe)
      if (request.auth) {
        await checkGlobalRateLimit(request.auth.uid, 'generateContent');
      }
      
      const { 
        prompt, 
        model = "gemini-2.5-flash",
        systemInstruction,
        temperature,
        maxOutputTokens,
        history,
        thinkingBudget
      } = request.data;

      if (!prompt) {
        throw new HttpsError("invalid-argument", "A 'prompt' mező kötelező.");
      }

      logger.info("Gemini request received", { 
        model,
        promptLength: prompt.length,
        hasSystemInstruction: !!systemInstruction,
        hasHistory: !!history
      });

      const ai = new GoogleGenAI({ apiKey: geminiApiKey.value() });

      const config = {};
      
      if (systemInstruction) {
        config.systemInstruction = systemInstruction;
      }
      
      if (temperature !== undefined) {
        config.temperature = temperature;
      }
      
      if (maxOutputTokens !== undefined) {
        config.maxOutputTokens = maxOutputTokens;
      }

      if (thinkingBudget !== undefined) {
        config.thinkingConfig = {
          thinkingBudget: thinkingBudget
        };
      }

      let responseText;

      if (history && Array.isArray(history) && history.length > 0) {
        const chat = ai.chats.create({
          model: model,
          history: history,
          config: Object.keys(config).length > 0 ? config : undefined
        });

        const response = await chat.sendMessage({ message: prompt });
        responseText = response.text;
      } else {
        const response = await ai.models.generateContent({
          model: model,
          contents: prompt,
          config: Object.keys(config).length > 0 ? config : undefined
        });
        responseText = response.text;
      }

      logger.info("Gemini response generated", { 
        responseLength: responseText?.length || 0 
      });

      return {
        success: true,
        text: responseText,
        model: model
      };

    } catch (error) {
      logger.error("Gemini API error:", error);
      
      if (error instanceof HttpsError) {
        throw error;
      }
      
      if (error.message?.includes("SAFETY")) {
        throw new HttpsError(
          "failed-precondition", 
          "A tartalom biztonsági okokból nem generálható."
        );
      }
      
      if (error.message?.includes("RATE_LIMIT") || error.message?.includes("quota")) {
        throw new HttpsError(
          "resource-exhausted", 
          "Túl sok kérés. Kérlek várj egy kicsit."
        );
      }

      throw new HttpsError(
        "internal", 
        "Hiba történt a válasz generálása közben."
      );
    }
  }
);

/**
 * Cloud Function for batch translation of dynamic content
 * Translates multiple texts at once while preserving brand names
 * 
 * @param {Object} request - The request object containing:
 *   - texts: Array of texts or object with text fields to translate
 *   - targetLanguage: The target language name (e.g., "Hungarian", "English")
 *   - sourceLanguage: (optional) Source language, auto-detected if not provided
 * @returns {Object} - Translated texts in the same structure as input
 */
exports.translateBatch = onCall(
  {
    region: "europe-west1",
    secrets: [geminiApiKey],
    enforceAppCheck: false,
  },
  async (request) => {
    try {
      // Global rate limiting (failsafe)
      if (request.auth) {
        await checkGlobalRateLimit(request.auth.uid, 'translateBatch');
      }
      
      const { 
        texts, 
        targetLanguage,
        sourceLanguage
      } = request.data;

      if (!texts) {
        throw new HttpsError("invalid-argument", "A 'texts' mező kötelező.");
      }

      if (!targetLanguage) {
        throw new HttpsError("invalid-argument", "A 'targetLanguage' mező kötelező.");
      }

      const isArray = Array.isArray(texts);
      const textsToTranslate = isArray ? texts : [texts];
      
      // Skip translation if texts are empty
      if (textsToTranslate.length === 0 || 
          textsToTranslate.every(t => !t || (typeof t === 'string' && t.trim() === ''))) {
        return {
          success: true,
          translated: texts,
          skipped: true
        };
      }

      logger.info("Translation batch request received", { 
        count: textsToTranslate.length,
        targetLanguage,
        sourceLanguage
      });

      const ai = new GoogleGenAI({ apiKey: geminiApiKey.value() });

      // Build the translation prompt
      const jsonInput = JSON.stringify(textsToTranslate, null, 2);
      
      const prompt = `Translate the following JSON array of texts to ${targetLanguage}.
${sourceLanguage ? `Source language: ${sourceLanguage}` : 'Detect the source language automatically.'}

Input JSON:
${jsonInput}

Return ONLY a valid JSON array with the translated texts in the same order. No markdown, no explanation.`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          systemInstruction: TRANSLATION_SYSTEM_INSTRUCTION,
          temperature: 0.1,
          thinkingConfig: {
            thinkingBudget: 0
          }
        }
      });

      let translatedTexts;
      try {
        // Clean the response - remove markdown code blocks if present
        let responseText = response.text.trim();
        if (responseText.startsWith('```json')) {
          responseText = responseText.slice(7);
        }
        if (responseText.startsWith('```')) {
          responseText = responseText.slice(3);
        }
        if (responseText.endsWith('```')) {
          responseText = responseText.slice(0, -3);
        }
        responseText = responseText.trim();
        
        translatedTexts = JSON.parse(responseText);
      } catch (parseError) {
        logger.error("Failed to parse translation response:", response.text);
        throw new HttpsError("internal", "A fordítás válasza nem megfelelő formátumú.");
      }

      logger.info("Translation batch completed", { 
        inputCount: textsToTranslate.length,
        outputCount: translatedTexts.length
      });

      return {
        success: true,
        translated: isArray ? translatedTexts : translatedTexts[0]
      };

    } catch (error) {
      logger.error("Translation API error:", error);
      
      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError("internal", "Hiba történt a fordítás közben.");
    }
  }
);

/**
 * Cloud Function for translating a single text with fields
 * Useful for translating objects with multiple text fields
 * 
 * @param {Object} request - The request object containing:
 *   - data: Object with text fields to translate
 *   - fields: Array of field names to translate
 *   - targetLanguage: The target language name
 * @returns {Object} - The data object with translated fields
 */
exports.translateFields = onCall(
  {
    region: "europe-west1",
    secrets: [geminiApiKey],
    enforceAppCheck: false,
  },
  async (request) => {
    try {
      // Global rate limiting (failsafe)
      if (request.auth) {
        await checkGlobalRateLimit(request.auth.uid, 'translateFields');
      }
      
      const { 
        data, 
        fields,
        targetLanguage
      } = request.data;

      if (!data || !fields || !targetLanguage) {
        throw new HttpsError("invalid-argument", "A 'data', 'fields' és 'targetLanguage' mezők kötelezőek.");
      }

      // Extract texts to translate
      const textsToTranslate = fields.map(field => {
        const value = field.includes('.') 
          ? field.split('.').reduce((obj, key) => obj?.[key], data)
          : data[field];
        return value || '';
      });

      // Skip if all texts are empty
      if (textsToTranslate.every(t => !t || t.trim() === '')) {
        return {
          success: true,
          data: data,
          skipped: true
        };
      }

      logger.info("Field translation request received", { 
        fields: fields.length,
        targetLanguage
      });

      const ai = new GoogleGenAI({ apiKey: geminiApiKey.value() });

      const jsonInput = JSON.stringify(textsToTranslate, null, 2);
      
      const prompt = `Translate the following JSON array of texts to ${targetLanguage}.

Input JSON:
${jsonInput}

Return ONLY a valid JSON array with the translated texts in the same order. No markdown, no explanation.`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          systemInstruction: TRANSLATION_SYSTEM_INSTRUCTION,
          temperature: 0.1,
          thinkingConfig: {
            thinkingBudget: 0
          }
        }
      });

      let translatedTexts;
      try {
        let responseText = response.text.trim();
        if (responseText.startsWith('```json')) {
          responseText = responseText.slice(7);
        }
        if (responseText.startsWith('```')) {
          responseText = responseText.slice(3);
        }
        if (responseText.endsWith('```')) {
          responseText = responseText.slice(0, -3);
        }
        responseText = responseText.trim();
        
        translatedTexts = JSON.parse(responseText);
      } catch (parseError) {
        logger.error("Failed to parse translation response:", response.text);
        throw new HttpsError("internal", "A fordítás válasza nem megfelelő formátumú.");
      }

      // Apply translated texts back to the data object
      const result = JSON.parse(JSON.stringify(data)); // Deep clone
      fields.forEach((field, index) => {
        if (field.includes('.')) {
          const keys = field.split('.');
          let obj = result;
          for (let i = 0; i < keys.length - 1; i++) {
            if (!obj[keys[i]]) obj[keys[i]] = {};
            obj = obj[keys[i]];
          }
          obj[keys[keys.length - 1]] = translatedTexts[index];
        } else {
          result[field] = translatedTexts[index];
        }
      });

      logger.info("Field translation completed", { 
        fields: fields.length
      });

      return {
        success: true,
        data: result
      };

    } catch (error) {
      logger.error("Field translation API error:", error);
      
      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError("internal", "Hiba történt a fordítás közben.");
    }
  }
);

/**
 * Cloud Function for streaming content generation
 */
exports.generateContentStream = onCall(
  {
    region: "europe-west1",
    secrets: [geminiApiKey],
  },
  async (request) => {
    try {
      // Global rate limiting (failsafe)
      if (request.auth) {
        await checkGlobalRateLimit(request.auth.uid, 'generateContentStream');
      }
      
      const { 
        prompt, 
        model = "gemini-2.5-flash",
        systemInstruction,
        temperature,
        maxOutputTokens,
        thinkingBudget
      } = request.data;

      if (!prompt) {
        throw new HttpsError("invalid-argument", "A 'prompt' mező kötelező.");
      }

      logger.info("Gemini stream request received", { model, promptLength: prompt.length });

      const ai = new GoogleGenAI({ apiKey: geminiApiKey.value() });

      const config = {};
      if (systemInstruction) config.systemInstruction = systemInstruction;
      if (temperature !== undefined) config.temperature = temperature;
      if (maxOutputTokens !== undefined) config.maxOutputTokens = maxOutputTokens;
      if (thinkingBudget !== undefined) {
        config.thinkingConfig = { thinkingBudget };
      }

      const response = await ai.models.generateContentStream({
        model: model,
        contents: prompt,
        config: Object.keys(config).length > 0 ? config : undefined
      });

      let fullText = "";
      for await (const chunk of response) {
        fullText += chunk.text || "";
      }

      logger.info("Gemini stream response completed", { responseLength: fullText.length });

      return {
        success: true,
        text: fullText,
        model: model
      };

    } catch (error) {
      logger.error("Gemini stream API error:", error);
      
      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError("internal", "Hiba történt a válasz generálása közben.");
    }
  }
);
