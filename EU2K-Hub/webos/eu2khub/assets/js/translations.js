// EU2K Hub Translation System
// Lightweight JSON-based translation manager with localStorage persistence

(function installConsoleFilter() {
    if (window.__eu2kConsoleFilterInstalled) return;
    window.__eu2kConsoleFilterInstalled = true;

    const DEV_MODE_KEY = 'eu2k-dev-mode';
    const original = {
        log: console.log.bind(console),
        info: console.info.bind(console),
        debug: console.debug.bind(console),
        warn: console.warn.bind(console),
        error: console.error.bind(console)
    };

    const isDevModeEnabled = () => {
        try {
            return localStorage.getItem(DEV_MODE_KEY) === 'true';
        } catch {
            return false;
        }
    };

    console.log = (...args) => {
        if (isDevModeEnabled()) original.log(...args);
    };
    console.info = (...args) => {
        if (isDevModeEnabled()) original.info(...args);
    };
    console.debug = (...args) => {
        if (isDevModeEnabled()) original.debug(...args);
    };
    console.warn = (...args) => {
        original.warn(...args);
    };
    console.error = (...args) => {
        original.error(...args);
    };
})();

class TranslationManager {
    constructor() {
        this.currentLanguage = 'hu';
        this.translations = {};
        this.brandNames = [
            'EU2K Hub', 'Hub', 'DÖK', 'Devs', 'YouHub', 'Hive', 'EU2K',
            'Európa 2000', 'Európa 2000 Gimnázium', 'Microsoft', 'OkosDoboz'
        ];
        this.storageKey = 'eu2k_language';
        this.isInitialized = false;
    }

    // Initialize translation system
    async init() {
        try {
            // Load saved language preference
            const savedLanguage = localStorage.getItem(this.storageKey);
            if (savedLanguage && (savedLanguage === 'hu' || savedLanguage === 'en')) {
                this.currentLanguage = savedLanguage;
            }

            // Load translations
            await this.loadTranslations(this.currentLanguage);
            
            // Wait for DOM to be ready
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => {
                    this.applyTranslations();
                    this.setupLanguageSwitchers();
                });
            } else {
                this.applyTranslations();
                this.setupLanguageSwitchers();
            }

            this.isInitialized = true;
            console.log('Translation system initialized successfully');
        } catch (error) {
            console.error('Error initializing translation system:', error);
        }
    }

    // Load translation file
    async loadTranslations(language) {
        try {
            // Simple approach: always try from root
            const response = await fetch(`./assets/translations/${language}.json`);
            if (!response.ok) {
                throw new Error(`Failed to load translations for ${language}`);
            }
            
            this.translations = await response.json();
            console.log(`Loaded translations for ${language}:`, this.translations);
        } catch (error) {
            console.error(`Error loading translations for ${language}:`, error);
            if (language !== 'hu') {
                // Fallback to Hungarian
                console.warn('Falling back to Hungarian translations');
                await this.loadTranslations('hu');
            } else {
                // If even Hungarian fails, create empty translations
                this.translations = {};
            }
        }
    }

    // Apply translations to all elements with data-translate attribute
    applyTranslations() {
        const elements = document.querySelectorAll('[data-translate]');
        console.log(`Found ${elements.length} translatable elements`);
        
        elements.forEach(element => {
            const key = element.getAttribute('data-translate');
            const fallback = element.getAttribute('data-translate-fallback') || element.textContent;
            
            try {
                const translation = this.getTranslation(key);
                if (translation) {
                    element.textContent = translation;
                    console.log(`Translated ${key} to: ${translation}`);
                } else {
                    console.warn(`Translation not found for key: ${key}`);
                    if (fallback) {
                        element.textContent = fallback;
                    }
                }
            } catch (error) {
                console.error(`Error translating ${key}:`, error);
                if (fallback) {
                    element.textContent = fallback;
                }
            }
        });

        // Apply translations to all elements with data-translate-placeholder attribute
        const placeholderElements = document.querySelectorAll('[data-translate-placeholder]');
        console.log(`Found ${placeholderElements.length} elements with translatable placeholders`);
        placeholderElements.forEach(element => {
            const key = element.getAttribute('data-translate-placeholder');
            const fallback = element.placeholder; // Use current placeholder as fallback

            try {
                const translation = this.getTranslation(key);
                if (translation) {
                    element.placeholder = translation;
                    console.log(`Translated placeholder ${key} to: ${translation}`);
                } else {
                    console.warn(`Translation not found for placeholder key: ${key}`);
                    if (fallback) {
                        element.placeholder = fallback;
                    }
                }
            } catch (error) {
                console.error(`Error translating placeholder ${key}:`, error);
                if (fallback) {
                    element.placeholder = fallback;
                }
            }
        });
    }

    // Get translation for a specific key
    getTranslation(key) {
        if (!this.translations) return null;
        
        const keys = key.split('.');
        let value = this.translations;
        
        for (const k of keys) {
            if (value && typeof value === 'object' && k in value) {
                value = value[k];
            } else {
                return null;
            }
        }
        
        return typeof value === 'string' ? value : null;
    }

    // Switch language
    async switchLanguage(language) {
        if (language === this.currentLanguage) return;
        
        try {
            this.currentLanguage = language;
            localStorage.setItem(this.storageKey, language);
            
            await this.loadTranslations(language);
            // Várunk egy kicsit, hogy a fordítások biztosan betöltődjenek
            await new Promise(resolve => setTimeout(resolve, 50));
            this.applyTranslations();

            // Frissítjük a nyelvválasztó radio button-ok állapotát
            this.updateLanguageSelector();

            console.log(`Language switched to: ${language}`);
        } catch (error) {
            console.error('Error switching language:', error);
        }
    }

    // Setup language switchers
    setupLanguageSwitchers() {
        // Radio buttons for language switching
        const languageRadios = document.querySelectorAll('input[name="language"]');
        languageRadios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                if (e.target.checked) {
                    const language = e.target.value;
                    this.switchLanguage(language);
                }
            });
        });

        // Frissítjük a jelenlegi nyelvnek megfelelően a radio button-ok állapotát
        this.updateLanguageSelector();

        // Material Design radio buttons for language switching
        const mdLanguageRadios = document.querySelectorAll('md-radio[name="language"]');
        mdLanguageRadios.forEach(radio => {
            // Set current language
            if (radio.value === this.currentLanguage) {
                radio.checked = true;
            }
        });

        // Language buttons
        const languageButtons = document.querySelectorAll('[data-language]');
        languageButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                const language = e.target.getAttribute('data-language');
                this.switchLanguage(language);
            });
        });
    }

    // Frissíti a nyelvválasztó radio button-ok állapotát a jelenlegi nyelvnek megfelelően
    updateLanguageSelector() {
        const languageRadios = document.querySelectorAll('input[name="language"]');
        languageRadios.forEach(radio => {
            radio.checked = (radio.value === this.currentLanguage);
        });
    }

    // Preserve brand names in translations
    preserveBrandNames(text) {
        if (!text) return text;
        
        let result = text;
        this.brandNames.forEach(brand => {
            const regex = new RegExp(brand, 'gi');
            result = result.replace(regex, brand);
        });
        
        return result;
    }
}

// Initialize translation system when script loads
const translationManager = new TranslationManager();

// Initialize immediately if DOM is ready, otherwise wait
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        translationManager.init();
    });
} else {
    translationManager.init();
}

// Export for global access
window.translationManager = translationManager;

function setLanguage(lang) {
  if (window.translationManager) {
    window.translationManager.switchLanguage(lang);
  }
}

// Gemini AI API configuration
const GEMINI_API_KEY = 'no peeking bruh';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

// AI Translation function
async function translateWithAI(text, targetLanguage) {
    if (!text) return '';
    
    try {
        const prompt = `Translate the following text to ${targetLanguage}: "${text}", only answer with the translated text, no other text or explanation.`;

        const response = await fetch(GEMINI_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-goog-api-key': GEMINI_API_KEY
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{
                        text: prompt
                    }]
                }]
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        const translatedText = data.candidates[0].content.parts[0].text.trim();

        console.log(`AI Translation: "${text}" → "${translatedText}"`);

        return translatedText;
    } catch (error) {
        console.error('Xelp API error:', error);
        return text; // Return original text on error
    }
}
