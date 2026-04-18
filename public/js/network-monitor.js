/**
 * NetworkMonitor - A utility to detect and display network status.
 * Handles Offline and Weak Network (2G/Slow-2G) states.
 */
export class NetworkMonitor {
    constructor(options = {}) {
        this.options = {
            onStatusChange: options.onStatusChange || null,
            containerId: 'network-monitor-banner'
        };
        
        NetworkMonitor.state = navigator.onLine ? 'online' : 'offline';
        this.connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;

        this.bannerEl = null;
        
        this.init();
    }

    init() {
        window.addEventListener('online', () => this.updateStatus('online'));
        window.addEventListener('offline', () => this.updateStatus('offline'));
        
        if (this.connection) {
            this.connection.addEventListener('change', () => this.checkConnectionQuality());
            this.checkConnectionQuality();
        }

        // Initial check
        this.updateStatus(navigator.onLine ? 'online' : 'offline');
    }

    checkConnectionQuality() {
        if (!navigator.onLine) return; // Offline takes priority

        if (this.connection) {
            const { effectiveType } = this.connection;
            if (effectiveType === 'slow-2g' || effectiveType === '2g') {
                this.updateStatus('weak');
            } else {
                this.updateStatus('online');
            }
        }
    }

    updateStatus(newStatus) {
        // Redundant status check to avoid flickering
        if (NetworkMonitor.state === newStatus && this.bannerEl) return;
        
        NetworkMonitor.state = newStatus;
        this.status = newStatus;
        this.renderBanner();

        
        if (this.options.onStatusChange) {
            this.options.onStatusChange(newStatus);
        }
    }

    renderBanner() {
        if (!this.bannerEl) {
            this.bannerEl = document.createElement('div');
            this.bannerEl.id = this.options.containerId;
            this.bannerEl.className = 'network-banner';
            document.body.prepend(this.bannerEl);
        }

        if (this.status === 'online') {
            this.bannerEl.classList.remove('active');
            return;
        }

        let config = {
            message: 'No internet connection',
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"></path><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"></path><path d="M10.71 5.05A16 16 0 0 1 22.58 9"></path><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"></path><path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path><line x1="12" y1="20" x2="12.01" y2="20"></line></svg>`,
            className: 'banner-offline'
        };

        if (this.status === 'weak') {
            config = {
                message: 'Weak network detected',
                icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"></path><path d="M1.42 9a16 16 0 0 1 21.16 0"></path><path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path><line x1="12" y1="20" x2="12.01" y2="20"></line></svg>`,
                className: 'banner-weak'
            };
        }

        this.bannerEl.innerHTML = `
            <div class="network-banner-content ${config.className}">
                <span class="network-icon">${config.icon}</span>
                <span class="network-text">${config.message}</span>
                <span class="network-subtext">${this.status === 'offline' ? 'Switched to offline mode' : 'Performance may be affected'}</span>
            </div>
        `;
        
        // Use a small timeout to ensure transition works if it was just added to DOM
        setTimeout(() => this.bannerEl.classList.add('active'), 10);
    }
}
