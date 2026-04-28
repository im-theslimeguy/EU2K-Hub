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

    // Get browser language
    getBrowserLanguage() {
        const validLanguages = ['hu', 'en', 'de', 'es', 'fr', 'zh', 'ja', 'sv', 'ru'];
        
        // Try to get language from navigator
        if (navigator.language) {
            const lang = navigator.language.toLowerCase().split('-')[0]; // Get language code (e.g., 'en' from 'en-US')
            if (validLanguages.includes(lang)) {
                return lang;
            }
        }
        
        // Try navigator.languages array
        if (navigator.languages && navigator.languages.length > 0) {
            for (const lang of navigator.languages) {
                const langCode = lang.toLowerCase().split('-')[0];
                if (validLanguages.includes(langCode)) {
                    return langCode;
                }
            }
        }
        
        // Fallback to Hungarian
        return 'hu';
    }

    // Initialize translation system
    async init() {
        try {
            // Load saved language preference
            const savedLanguage = localStorage.getItem(this.storageKey);
            const validLanguages = ['hu', 'en', 'de', 'es', 'fr', 'zh', 'ja', 'sv', 'ru'];
            
            if (savedLanguage && validLanguages.includes(savedLanguage)) {
                // Use saved language if available
                this.currentLanguage = savedLanguage;
            } else {
                // Try to detect browser language
                this.currentLanguage = this.getBrowserLanguage();
                // Save detected language
                localStorage.setItem(this.storageKey, this.currentLanguage);
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
            
            // Wait for Flutter iframes to be ready before logging success
            this.waitForFlutterReady().then(() => {
                console.log('Translation system initialized successfully');
            }).catch(() => {
                // Fallback: log after timeout if Flutter doesn't load
                setTimeout(() => {
                    console.log('Translation system initialized successfully');
                }, 1000);
            });
        } catch (error) {
            console.error('Error initializing translation system:', error);
        }
    }

    // Wait for Flutter iframes to be ready
    async waitForFlutterReady() {
        return new Promise((resolve, reject) => {
            // Check if Flutter handler is available
            const checkFlutterHandler = () => {
                if (window.flutterHandler) {
                    // Check if both contained and uncontained iframes are ready
                    const containedReady = window.flutterHandler.isReady('contained');
                    const uncontainedReady = window.flutterHandler.isReady('uncontained');
                    
                    if (containedReady && uncontainedReady) {
                        console.log('Flutter iframes are ready, translation system can proceed');
                        resolve();
                    } else {
                        // Keep checking every 100ms
                        setTimeout(checkFlutterHandler, 100);
                    }
                } else {
                    // Keep checking for Flutter handler every 100ms
                    setTimeout(checkFlutterHandler, 100);
                }
            };
            
            // Start checking
            checkFlutterHandler();
            
            // Timeout after 5 seconds
            setTimeout(() => {
                reject(new Error('Flutter iframes not ready within timeout'));
            }, 5000);
        });
    }

    // Load translation file
    async loadTranslations(language) {
        try {
            // Use relative path
            const response = await fetch(`assets/translations/${language}.json`);
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

    applyTranslations() {
        // Jelöljük meg, hogy a fordítások alkalmazása elkezdődött
        window.__eu2kTranslationsApplying = true;
        
        // Plain text elemek
        document.querySelectorAll('[data-translate]').forEach(element => {
            const key = element.getAttribute('data-translate');
            const fallback = element.getAttribute('data-translate-fallback') || element.textContent;
            const translation = this.getTranslation(key);

            if (translation) {
                element.textContent = translation; // ✅ csak sima szöveg
            } else if (fallback) {
                element.textContent = fallback;
            }
        });

        // HTML-t tartalmazó elemek
        document.querySelectorAll('[data-translate-html]').forEach(element => {
            const key = element.getAttribute('data-translate-html');
            const fallback = element.getAttribute('data-translate-fallback') || element.innerHTML;
            const translation = this.getTranslation(key);

            if (translation) {
                element.innerHTML = translation; // ✅ itt a link is kattintható lesz
            } else if (fallback) {
                element.innerHTML = fallback;
            }
        });

        // Placeholder-ek
        const placeholderElements = document.querySelectorAll('[data-translate-placeholder]');
        placeholderElements.forEach(element => {
            const key = element.getAttribute('data-translate-placeholder');
            const fallback = element.placeholder;
            const translation = this.getTranslation(key);

            if (translation) {
                element.placeholder = translation;
            } else if (fallback) {
                element.placeholder = fallback;
            }
        });
        
        // Jelöljük meg, hogy a fordítások alkalmazva lettek
        window.__eu2kTranslationsApplied = true;
    }

    // Apply translations to dynamically created elements (e.g., admin console)
    applyTranslationsToElement(element) {
        if (!element) return;
        
        // Plain text elements
        element.querySelectorAll('[data-translate]').forEach(el => {
            const key = el.getAttribute('data-translate');
            const fallback = el.getAttribute('data-translate-fallback') || el.textContent;
            const translation = this.getTranslation(key);
            if (translation) {
                el.textContent = translation;
            } else if (fallback) {
                el.textContent = fallback;
            }
        });

        // HTML elements
        element.querySelectorAll('[data-translate-html]').forEach(el => {
            const key = el.getAttribute('data-translate-html');
            const fallback = el.getAttribute('data-translate-fallback') || el.innerHTML;
            const translation = this.getTranslation(key);
            if (translation) {
                el.innerHTML = translation;
            } else if (fallback) {
                el.innerHTML = fallback;
            }
        });

        // Placeholders
        element.querySelectorAll('[data-translate-placeholder]').forEach(el => {
            const key = el.getAttribute('data-translate-placeholder');
            const fallback = el.placeholder;
            const translation = this.getTranslation(key);
            if (translation) {
                el.placeholder = translation;
            } else if (fallback) {
                el.placeholder = fallback;
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
        
        // Return strings and arrays, but not objects
        if (typeof value === 'string' || Array.isArray(value)) {
            return value;
        }
        return null;
    }

    // Switch language (force újratöltés opcionális)
    async switchLanguage(language, force = false) {
        if (!force && language === this.currentLanguage) {
            // Mégis alkalmazzuk a fordításokat, ha ugyanaz a nyelv (pl. oldal újratöltés után)
            this.applyTranslations();
            return;
        }
        
        try {
            this.currentLanguage = language;
            localStorage.setItem(this.storageKey, language);
            
            await this.loadTranslations(language);
            // Várunk egy kicsit, hogy a fordítások biztosan betöltődjenek
            await new Promise(resolve => setTimeout(resolve, 50));
            this.applyTranslations();

            // Frissítjük a nyelvválasztó radio button-ok állapotát
            this.updateLanguageSelector();

            // Apply translations to admin console if it exists
            const adminConsole = document.getElementById('adminConsole');
            if (adminConsole) {
                this.applyTranslationsToElement(adminConsole);
            }
            const adminConsolePopup = document.getElementById('adminConsolePopup');
            if (adminConsolePopup) {
                this.applyTranslationsToElement(adminConsolePopup);
            }
            const adminAssignClassPopup1 = document.getElementById('adminAssignClassPopup1');
            if (adminAssignClassPopup1) {
                this.applyTranslationsToElement(adminAssignClassPopup1);
            }
            const adminAssignClassPopup2 = document.getElementById('adminAssignClassPopup2');
            if (adminAssignClassPopup2) {
                this.applyTranslationsToElement(adminAssignClassPopup2);
            }

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

// AI Translation function using Cloud Function (API key secured server-side)
async function translateWithAI(text, targetLanguage) {
    if (!text) return '';
    
    try {
        const prompt = `Translate the following text to ${targetLanguage}: "${text}", only answer with the translated text, no other text or explanation.`;

        // Use Cloud Function to call Gemini API - API key is stored securely in the function
        const { getFunctions, httpsCallable } = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-functions.js");
        const functions = getFunctions(window.firebaseApp || window.app, 'europe-west1');
        const generateContent = httpsCallable(functions, 'generateContent');
        
        const result = await generateContent({
            prompt: prompt,
            model: 'gemini-2.5-flash',
            thinkingBudget: 0 // Disable thinking for faster translations
        });

        const translatedText = result.data.text?.trim() || text;

        console.log(`AI Translation: "${text}" → "${translatedText}"`);

        return translatedText;
    } catch (error) {
        console.error('AI Translation error:', error);
        return text; // Return original text on error
    }
}
