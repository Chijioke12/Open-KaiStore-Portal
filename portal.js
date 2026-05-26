'use strict';

const Portal = {
    zipFile: null,
    appMetadata: null,
    githubConfig: {
        token: '',
        repo: '',
        branch: 'main',
    },

    init() {
        this.cacheDOM();
        this.bindEvents();
        this.loadConfig();
        this.registerServiceWorker();
    },

    cacheDOM() {
        this.dropZone = document.getElementById('drop-zone');
        this.zipInput = document.getElementById('zip-input');
        this.fileInfo = document.getElementById('file-info');
        this.fileName = document.getElementById('file-name');
        this.previewSection = document.getElementById('preview-section');
        this.previewIcon = document.getElementById('preview-icon');
        this.previewName = document.getElementById('preview-name');
        this.previewDesc = document.getElementById('preview-desc');
        this.deployBtn = document.getElementById('deploy-btn');
        this.statusSection = document.getElementById('status-section');
        this.statusMessage = document.getElementById('status-message');
        this.progressBar = document.getElementById('progress-bar');
        this.tokenInput = document.getElementById('gh-token');
        this.repoInput = document.getElementById('gh-repo');
    },

    bindEvents() {
        this.dropZone.onclick = () => this.zipInput.click();
        this.zipInput.onchange = (e) => this.handleFileSelect(e.target.files[0]);
        
        this.dropZone.ondragover = (e) => {
            e.preventDefault();
            this.dropZone.classList.add('active');
        };
        this.dropZone.ondragleave = () => this.dropZone.classList.remove('active');
        this.dropZone.ondrop = (e) => {
            e.preventDefault();
            this.handleFileSelect(e.dataTransfer.files[0]);
        };

        this.deployBtn.onclick = () => this.deploy();
        
        this.tokenInput.onchange = () => this.saveConfig();
        this.repoInput.onchange = () => this.saveConfig();
    },

    saveConfig() {
        localStorage.setItem('gh-token', this.tokenInput.value);
        localStorage.setItem('gh-repo', this.repoInput.value);
    },

    loadConfig() {
        this.tokenInput.value = localStorage.getItem('gh-token') || '';
        this.repoInput.value = localStorage.getItem('gh-repo') || 'Chijioke12/Open-KaiStore-Registry';
    },

    registerServiceWorker() {
        if (!('serviceWorker' in navigator)) return;
        navigator.serviceWorker.register('sw.js').catch(() => {});
    },

    async handleFileSelect(file) {
        if (!file || !file.name.endsWith('.zip')) {
            alert('Please select a valid ZIP file.');
            return;
        }

        this.zipFile = file;
        this.fileName.textContent = file.name;
        this.fileInfo.classList.remove('hidden');
        this.showStatus('Extracting metadata...', 'info');

        try {
            const zip = await JSZip.loadAsync(file);
            const manifestFile = zip.file('manifest.webapp');
            
            if (!manifestFile) {
                throw new Error('manifest.webapp not found in ZIP');
            }

            const manifestText = await manifestFile.async('text');
            const manifest = JSON.parse(manifestText);
            
            this.appMetadata = {
                name: manifest.name,
                description: manifest.description,
                author: manifest.developer ? manifest.developer.name : 'Unknown',
                version: manifest.version,
                icons: manifest.icons
            };

            // Extract the first available icon
            if (manifest.icons) {
                const iconSizes = Object.keys(manifest.icons).sort((a, b) => b - a);
                const bestIconPath = manifest.icons[iconSizes[0]];
                // Remove leading slash if present
                const cleanPath = bestIconPath.startsWith('/') ? bestIconPath.slice(1) : bestIconPath;
                const iconFile = zip.file(cleanPath);
                
                if (iconFile) {
                    const iconBlob = await iconFile.async('blob');
                    this.previewIcon.src = URL.createObjectURL(iconBlob);
                    this.previewIcon.classList.remove('hidden');
                    this.appMetadata.iconBlob = iconBlob;
                    this.appMetadata.iconName = `icon-${iconSizes[0]}.png`;
                }
            }

            this.renderPreview();
        } catch (err) {
            this.showStatus('Error: ' + err.message, 'error');
        }
    },

    renderPreview() {
        this.previewName.textContent = this.appMetadata.name;
        this.previewDesc.textContent = this.appMetadata.description || 'No description provided.';
        this.previewSection.classList.remove('hidden');
        this.statusSection.classList.add('hidden');
    },

    showStatus(msg, type) {
        this.statusSection.classList.remove('hidden');
        this.statusMessage.textContent = msg;
        this.statusMessage.className = type;
        if (type === 'error') this.progressBar.style.width = '100%';
    },

    updateProgress(percent) {
        this.progressBar.style.width = percent + '%';
    },

    async deploy() {
        const token = this.tokenInput.value;
        const repo = this.repoInput.value;

        if (!token || !repo) {
            alert('Please provide GitHub Token and Repo.');
            return;
        }

        this.showStatus('Connecting to GitHub...', 'info');
        this.updateProgress(10);

        try {
            // 1. Upload ZIP
            this.showStatus('Uploading ZIP...', 'info');
            const zipBase64 = await this.toBase64(this.zipFile);
            const zipPath = `apps/${this.appMetadata.name.replace(/\s+/g, '-').toLowerCase()}.zip`;
            await this.uploadToGitHub(repo, zipPath, zipBase64, token);
            this.updateProgress(40);

            // 2. Upload Icon
            let iconUrl = '';
            if (this.appMetadata.iconBlob) {
                this.showStatus('Uploading Icon...', 'info');
                const iconBase64 = await this.toBase64(this.appMetadata.iconBlob);
                const iconPath = `icons/${this.appMetadata.name.replace(/\s+/g, '-').toLowerCase()}-${this.appMetadata.iconName}`;
                await this.uploadToGitHub(repo, iconPath, iconBase64, token);
                iconUrl = `https://raw.githubusercontent.com/${repo}/main/${iconPath}`;
            }
            this.updateProgress(70);

            // 3. Update apps.json
            this.showStatus('Updating Registry...', 'info');
            await this.updateRegistry(repo, token, zipPath, iconUrl);
            this.updateProgress(100);

            this.showStatus('Success! App deployed to your store.', 'success');
        } catch (err) {
            this.showStatus('Deployment failed: ' + err.message, 'error');
        }
    },

    async uploadToGitHub(repo, path, content, token) {
        const getSha = async () => {
            try {
                const rawUrl = `https://api.github.com/repos/${repo}/contents/${path}`;
                const res = await fetch(rawUrl, { headers: { 'Authorization': `token ${token}` } });
                if (!res.ok) return null;
                const data = await res.json();
                return data.sha || null;
            } catch (e) {
                return null;
            }
        };

        const putOnce = async (sha) => {
            const body = {
                message: `Add/Update ${path}`,
                content: content.split(',')[1], // remove data:xxx/xxx;base64,
            };
            if (typeof sha === 'string' && sha.length) body.sha = sha;
            const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `token ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });

            if (res.ok) return;
            const err = await res.json().catch(() => ({}));
            throw new Error(err && err.message ? err.message : 'Unknown error');
        };

        // First attempt with current SHA (if the file exists)
        let sha = await getSha();
        try {
            await putOnce(sha);
        } catch (e) {
            // If the file changed between fetch and update, refetch SHA and retry once
            const msg = (e && e.message) ? e.message : '';
            if (/does not match/i.test(msg) || /sha/i.test(msg)) {
                sha = await getSha();
                await putOnce(sha);
                return;
            }
            throw e;
        }
    },

    async updateRegistry(repo, token, zipPath, iconUrl) {
        const path = 'apps.json';

        const fetchAppsJson = async () => {
            let sha = null;
            let apps = [];

            const rawUrl = `https://api.github.com/repos/${repo}/contents/${path}`;
            const res = await fetch(rawUrl, { headers: { 'Authorization': `token ${token}` } });

            if (res.ok) {
                const data = await res.json();
                sha = data.sha || null;
                const content = atob(data.content || '');
                apps = JSON.parse(content).apps || [];
            }

            return { sha, apps };
        };

        const buildUpdatedContent = (apps) => {
            const appEntry = {
                id: this.appMetadata.name.toLowerCase().replace(/\s+/g, '-'),
                name: this.appMetadata.name,
                author: this.appMetadata.author,
                description: this.appMetadata.description,
                icon: iconUrl,
                type: 'packaged',
                download_url: `https://raw.githubusercontent.com/${repo}/main/${zipPath}`
            };

            const existingIndex = apps.findIndex(a => a.id === appEntry.id);
            if (existingIndex > -1) {
                apps[existingIndex] = appEntry;
            } else {
                apps.push(appEntry);
            }

            return btoa(JSON.stringify({ apps: apps }, null, 2));
        };

        const putAppsJson = async (sha, updatedContent) => {
            const body = {
                message: `Update registry with ${this.appMetadata.name}`,
                content: updatedContent,
            };
            if (typeof sha === 'string' && sha.length) body.sha = sha;
            const updateRes = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `token ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });

            if (updateRes.ok) return;
            const err = await updateRes.json().catch(() => ({}));
            throw new Error(err && err.message ? err.message : 'Unknown error');
        };

        // Attempt 1
        let { sha, apps } = await fetchAppsJson();
        let updatedContent = buildUpdatedContent(apps);
        try {
            await putAppsJson(sha, updatedContent);
        } catch (e) {
            // If apps.json changed remotely between fetch and update, refetch and retry once
            const msg = (e && e.message) ? e.message : '';
            if (/does not match/i.test(msg) || /sha/i.test(msg)) {
                ({ sha, apps } = await fetchAppsJson());
                updatedContent = buildUpdatedContent(apps);
                await putAppsJson(sha, updatedContent);
                return;
            }
            throw e;
        }
    },

    toBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve(reader.result);
            reader.onerror = error => reject(error);
        });
    }
};

Portal.init();
