/**
 * Language Dropdown Component
 * Native dropdown component for language selection
 */
class LanguageDropdown {
  constructor(container, options = {}) {
    this.container = container;
    this._options = options.options || ['Magyar', 'English'];
    this.onChange = options.onChange || null;
    this.placeholder = options.placeholder || null;
    
    // Handle initialValue (find index by value) or selectedIndex
    if (options.initialValue !== undefined) {
      const foundIndex = this._options.findIndex(opt => {
        if (typeof opt === 'object' && opt !== null) {
          return opt.value === options.initialValue;
        }
        return opt === options.initialValue;
      });
      this.selectedIndex = foundIndex >= 0 ? foundIndex : 0;
    } else {
      this.selectedIndex = options.selectedIndex || 0;
    }
    
    this.isOpen = false;
    this.isSingleItem = true;
    
    this.init();
  }
  
  init() {
    // Clear container first to avoid duplicates
    this.container.innerHTML = '';
    this.createDropdown();
    this.attachEvents();
    this.updateDisplay();
  }
  
  destroy() {
    // Remove all dropdown elements from container
    if (this.trigger && this.trigger.parentNode) {
      this.trigger.parentNode.removeChild(this.trigger);
    }
    if (this.menu && this.menu.parentNode) {
      this.menu.parentNode.removeChild(this.menu);
    }
    // Clear container
    this.container.innerHTML = '';
  }
  
  // Helper to get display text from option (supports both string and {label} object)
  getOptionLabel(option) {
    if (typeof option === 'object' && option !== null && option.label) {
      return option.label;
    }
    return String(option);
  }
  
  // Helper to get value from option (supports both string and {value} object)
  getOptionValue(option) {
    if (typeof option === 'object' && option !== null && option.value !== undefined) {
      return option.value;
    }
    return option;
  }
  
  createDropdown() {
    // Create trigger button
    this.trigger = document.createElement('button');
    this.trigger.className = 'language-dropdown-trigger single-item';
    this.trigger.setAttribute('type', 'button');
    this.trigger.setAttribute('aria-haspopup', 'true');
    this.trigger.setAttribute('aria-expanded', 'false');
    
    // Create text span
    this.textSpan = document.createElement('span');
    this.textSpan.className = 'language-dropdown-text';
    
    // Create icon
    this.icon = document.createElement('img');
    this.icon.className = 'language-dropdown-icon';
    this.icon.src = 'assets/general/components/arrow_down.svg';
    this.icon.alt = 'Dropdown';
    
    this.trigger.appendChild(this.textSpan);
    this.trigger.appendChild(this.icon);
    
    // Create menu
    this.menu = document.createElement('div');
    this.menu.className = 'language-dropdown-menu';
    this.menu.setAttribute('role', 'menu');
    
    // Create wrapper for items (vágja le a kilógó elemeket)
    this.menuWrapper = document.createElement('div');
    this.menuWrapper.className = 'language-dropdown-menu-wrapper';
    this.menu.appendChild(this.menuWrapper);
    
    // Create items
    this.items = [];
    this.options.forEach((option, index) => {
      const item = document.createElement('button');
      item.className = 'language-dropdown-item';
      item.setAttribute('role', 'menuitem');
      item.setAttribute('data-index', index);
      
      const content = document.createElement('div');
      content.className = 'language-dropdown-item-content';
      content.textContent = this.getOptionLabel(option);
      
      item.appendChild(content);
      this.menuWrapper.appendChild(item);
      this.items.push(item);
    });
    
    // Append to container
    this.container.appendChild(this.trigger);
    this.container.appendChild(this.menu);
  }
  
  attachEvents() {
    // Toggle on trigger click
    this.trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });
    
    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!this.container.contains(e.target)) {
        this.close();
      }
    });
    
    // Handle item clicks
    this.items.forEach((item, index) => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectItem(index);
      });
    });
  }
  
  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }
  
  open() {
    if (this.isOpen) return;
    
    this.isOpen = true;
    this.isSingleItem = false;
    
    // Update trigger border radius
    this.trigger.classList.remove('single-item');
    this.trigger.style.borderBottomLeftRadius = '0';
    this.trigger.style.borderBottomRightRadius = '0';
    
    this.menu.classList.add('open');
    this.icon.classList.add('open');
    this.trigger.setAttribute('aria-expanded', 'true');
    
    // Calculate max height based on available space (main-scroll-area padding: 22px)
    const rect = this.container.getBoundingClientRect();
    const scrollArea = document.querySelector('.main-scroll-area');
    if (scrollArea) {
      const scrollAreaRect = scrollArea.getBoundingClientRect();
      const availableHeight = scrollAreaRect.bottom - rect.bottom - 22; // 22px padding

      // Globális vagy per-oldal max magasság (pl. settings.html-ben állítva)
      let globalMaxHeight = 400;
      if (typeof window !== 'undefined' && typeof window.languageDropdownMaxHeight === 'number') {
        globalMaxHeight = window.languageDropdownMaxHeight;
      }

      // Per-komponens override data-attribútummal, ha kell
      let customMaxHeight = null;
      if (this.container && this.container.dataset && this.container.dataset.dropdownMaxHeight) {
        const parsed = parseInt(this.container.dataset.dropdownMaxHeight, 10);
        if (!Number.isNaN(parsed) && parsed > 0) {
          customMaxHeight = parsed;
        }
      }

      const limit = customMaxHeight != null ? customMaxHeight : globalMaxHeight;
      const maxMenuHeight = Math.max(120, Math.min(availableHeight, limit)); // Minimum height to keep scrolling usable
      this.menu.style.maxHeight = `${maxMenuHeight}px`;
    }
    
    // Reorder items: move selected to top
    this.reorderItems();
  }
  
  close() {
    if (!this.isOpen) return;
    
    this.isOpen = false;
    this.isSingleItem = true;
    
    // Restore trigger border radius
    this.trigger.classList.add('single-item');
    this.trigger.style.borderBottomLeftRadius = '';
    this.trigger.style.borderBottomRightRadius = '';
    
    this.menu.classList.remove('open');
    this.icon.classList.remove('open');
    this.trigger.setAttribute('aria-expanded', 'false');
    
    // Reset max-height
    this.menu.style.maxHeight = '';
    if (this.menuWrapper) {
      this.menuWrapper.scrollTop = 0;
    }
    
    // Restore original order
    this.restoreOrder();
  }
  
  selectItem(index) {
    // If clicking on the same item, just close
    if (index === this.selectedIndex) {
      this.close();
      return;
    }
    
    // Update selected index
    this.selectedIndex = index;
    
    // Update display
    this.updateDisplay();
    
    // Close dropdown
    this.close();
    
    // Call onChange callback with value (for object options) or the option itself (for string options)
    if (this.onChange) {
      const option = this.options[this.selectedIndex];
      this.onChange(this.getOptionValue(option), this.selectedIndex);
    }
  }
  
  reorderItems() {
    // Remove all items
    if (this.menuWrapper) {
      this.menuWrapper.innerHTML = '';
    } else {
      this.menu.innerHTML = '';
      this.menuWrapper = document.createElement('div');
      this.menuWrapper.className = 'language-dropdown-menu-wrapper';
      this.menu.appendChild(this.menuWrapper);
    }
    
    // Add other items (excluding selected)
    let menuIndex = 0;
    this.options.forEach((option, index) => {
      if (index !== this.selectedIndex) {
        const item = document.createElement('button');
        item.className = 'language-dropdown-item';
        item.setAttribute('role', 'menuitem');
        item.setAttribute('data-index', index);
        
        const content = document.createElement('div');
        content.className = 'language-dropdown-item-content';
        content.textContent = this.getOptionLabel(option);
        
        item.appendChild(content);
        this.menuWrapper.appendChild(item);
        
        // Reattach click event
        const currentMenuIndex = menuIndex;
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          this.selectItem(index);
        });
        menuIndex++;
      }
    });
    
    // Update items array
    this.items = Array.from(this.menuWrapper.querySelectorAll('.language-dropdown-item'));
  }
  
  restoreOrder() {
    // Restore original order when closed
    this.menu.innerHTML = '';
    this.menuWrapper = document.createElement('div');
    this.menuWrapper.className = 'language-dropdown-menu-wrapper';
    this.menu.appendChild(this.menuWrapper);
    
    this.options.forEach((option, index) => {
      const item = document.createElement('button');
      item.className = 'language-dropdown-item';
      item.setAttribute('role', 'menuitem');
      item.setAttribute('data-index', index);
      
      const content = document.createElement('div');
      content.className = 'language-dropdown-item-content';
      content.textContent = this.getOptionLabel(option);
      
      item.appendChild(content);
      this.menuWrapper.appendChild(item);
      
      // Reattach click event
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectItem(index);
      });
    });
    
    // Update items array
    this.items = Array.from(this.menuWrapper.querySelectorAll('.language-dropdown-item'));
  }
  
  updateDisplay() {
    const option = this.options[this.selectedIndex];
    if (option !== undefined) {
      const label = this.getOptionLabel(option);
      const value = this.getOptionValue(option);
      // Show placeholder if value is empty and placeholder is set
      if (this.placeholder && (value === '' || value === null || value === undefined)) {
        this.textSpan.textContent = this.placeholder;
      } else {
        this.textSpan.textContent = label;
      }
    } else if (this.placeholder) {
      this.textSpan.textContent = this.placeholder;
    } else {
      this.textSpan.textContent = '';
    }
  }
  
  getSelected() {
    const option = this.options[this.selectedIndex];
    return this.getOptionValue(option);
  }
  
  getSelectedOption() {
    return this.options[this.selectedIndex];
  }
  
  setSelected(index) {
    if (index >= 0 && index < this.options.length) {
      this.selectedIndex = index;
      this.updateDisplay();
    }
  }
  
  // Setter for options that rebuilds the menu
  set options(newOptions) {
    if (!Array.isArray(newOptions)) return;
    this._options = newOptions;
    // Rebuild menu items
    if (this.menuWrapper) {
      this.menuWrapper.innerHTML = '';
    } else {
      this.menu.innerHTML = '';
      this.menuWrapper = document.createElement('div');
      this.menuWrapper.className = 'language-dropdown-menu-wrapper';
      this.menu.appendChild(this.menuWrapper);
    }
    this.items = [];
    newOptions.forEach((option, index) => {
      const item = document.createElement('button');
      item.className = 'language-dropdown-item';
      item.setAttribute('role', 'menuitem');
      item.setAttribute('data-index', index);
      
      const content = document.createElement('div');
      content.className = 'language-dropdown-item-content';
      content.textContent = this.getOptionLabel(option);
      
      item.appendChild(content);
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectItem(index);
      });
      this.menuWrapper.appendChild(item);
      this.items.push(item);
    });
    // Update display with current selection
    if (this.selectedIndex >= 0 && this.selectedIndex < newOptions.length) {
      this.updateDisplay();
    } else if (newOptions.length > 0) {
      this.selectedIndex = 0;
      this.updateDisplay();
    }
  }
  
  // Getter for options
  get options() {
    return this._options || [];
  }
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
  module.exports = LanguageDropdown;
}

// Make available globally
if (typeof window !== 'undefined') {
  window.LanguageDropdown = LanguageDropdown;
}

