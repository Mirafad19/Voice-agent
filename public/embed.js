(function() {
    var script = document.currentScript;
    if (!script) return;

    var config = script.getAttribute('data-config');
    var baseUrl = script.getAttribute('data-base-url') || script.src.split('/embed.js')[0];
    
    if (!config) {
        console.error('AI Agent: Missing data-config attribute');
        return;
    }

    var iframe = document.createElement('iframe');
    var iframeId = 'ai-agent-iframe-' + Math.random().toString(36).substring(7);
    iframe.id = iframeId;
    iframe.src = baseUrl + '?config=' + config;
    
    // Initial Styles (Matching the closed widget state)
    var styles = {
        border: 'none',
        outline: 'none',
        background: 'transparent',
        width: '80px',
        height: '80px',
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        zIndex: '999999',
        overflow: 'hidden',
        pointerEvents: 'auto',
        borderRadius: '20px',
        transition: 'width 0.3s cubic-bezier(0.19, 1, 0.22, 1), height 0.3s cubic-bezier(0.19, 1, 0.22, 1), opacity 0.2s ease, transform 0.3s cubic-bezier(0.19, 1, 0.22, 1)',
        boxShadow: 'none'
    };

    Object.assign(iframe.style, styles);
    
    iframe.title = 'AI Voice Agent';
    iframe.setAttribute('allow', 'microphone');
    iframe.setAttribute('frameborder', '0');
    iframe.setAttribute('scrolling', 'no');
    iframe.setAttribute('allowtransparency', 'true');
    
    document.body.appendChild(iframe);
    
    window.addEventListener('message', function(event) {
        if (event.source !== iframe.contentWindow) return;
        
        if (event.data && event.data.type === 'agent-widget-resize') {
            var isMobile = window.innerWidth < 768;
            var isOpen = event.data.isOpen;
            
            if (isMobile && isOpen) {
                iframe.style.bottom = '0';
                iframe.style.right = '0';
                iframe.style.left = '0';
                iframe.style.top = '0';
                iframe.style.width = '100%';
                iframe.style.height = '100%';
                iframe.style.borderRadius = '0';
                iframe.style.boxShadow = 'none';
            } else {
                iframe.style.bottom = '20px';
                iframe.style.right = '20px';
                iframe.style.left = 'auto';
                iframe.style.top = 'auto';
                iframe.style.width = event.data.width + 'px';
                iframe.style.height = event.data.height + 'px';
                iframe.style.borderRadius = isOpen ? '24px' : '20px';
                iframe.style.boxShadow = isOpen ? '0 25px 50px -12px rgba(0, 0, 0, 0.25)' : 'none';
            }
        }
    });
})();
