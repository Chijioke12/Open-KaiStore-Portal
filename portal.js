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

        this.loadAppsBtn = document.getElementById('load-apps-btn');
        this.deleteFilesCheckbox = document.getElementById('delete-files-checkbox');
        this.manageMessage = document.getElementById('manage-message');
        this.appsList = document.getElementById('apps-list');
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

        if (this.loadAppsBtn) {
            this.loadAppsBtn.onclick = () => this.loadApps();
        }
        
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

    async getRepoFile(repo, path, token) {
        const url = `https://api.github.com/repos/${repo}/contents/${path}`;
        const res = await fetch(url, { headers: { 'Authorization': `token ${token}` } });
        if (res.status === 404) return { exists: false, sha: null, text: '' };
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err && err.message ? err.message : `HTTP ${res.status}`);
        }
        const data = await res.json();
        const content = data && data.content ? atob(data.content) : '';
        return { exists: true, sha: data.sha || null, text: content };
    },

    async putRepoFile(repo, path, token, message, base64Content, sha) {
        const body = { message, content: base64Content };
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
    },

    async deleteRepoFile(repo, path, token, message) {
        const url = `https://api.github.com/repos/${repo}/contents/${path}`;
        const getRes = await fetch(url, { headers: { 'Authorization': `token ${token}` } });
        if (getRes.status === 404) return;
        if (!getRes.ok) {
            const err = await getRes.json().catch(() => ({}));
            throw new Error(err && err.message ? err.message : 'Unknown error');
        }
        const data = await getRes.json();
        const sha = data && data.sha ? data.sha : null;
        if (!sha) return;

        const delRes = await fetch(url, {
            method: 'DELETE',
            headers: {
                'Authorization': `token ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ message, sha })
        });
        if (delRes.ok) return;
        const err = await delRes.json().catch(() => ({}));
        throw new Error(err && err.message ? err.message : 'Unknown error');
    },

    async updateRegistry(repo, token, zipPath, iconUrl) {
        const path = 'apps.json';

        const getPagesManifestUrl = (appId) => {
            // GitHub Pages URL format: https://<owner>.github.io/<repo>/...
            const parts = (repo || '').split('/');
            if (parts.length !== 2) return '';
            const owner = parts[0];
            const repoName = parts[1];
            return `https://${owner}.github.io/${repoName}/manifests/${appId}.json`;
        };

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
            const appId = this.appMetadata.name.toLowerCase().replace(/\s+/g, '-');
            const appEntry = {
                id: appId,
                name: this.appMetadata.name,
                author: this.appMetadata.author,
                description: this.appMetadata.description,
                icon: iconUrl,
                type: 'packaged',
                download_url: `https://raw.githubusercontent.com/${repo}/main/${zipPath}`,
                // Optional: GitHub Pages-served mini-manifest (generated by registry repo Actions)
                manifest_url: getPagesManifestUrl(appId)
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

    setManageMessage(text, type) {
        if (!this.manageMessage) return;
        this.manageMessage.textContent = text || '';
        this.manageMessage.className = 'manage-message ' + (type || '');
    },

    renderAppsManager(apps) {
        if (!this.appsList) return;
        this.appsList.innerHTML = '';

        if (!apps.length) {
            this.appsList.innerHTML = '<div class="error">No apps found in registry.</div>';
            return;
        }

        for (const app of apps) {
            const row = document.createElement('div');
            row.className = 'app-row';
            const safeName = app && app.name ? app.name : '(Unnamed)';
            const safeId = app && app.id ? app.id : '';
            const safeAuthor = app && app.author ? app.author : '';
            const icon = app && app.icon ? app.icon : '';

            row.innerHTML = `
                <img src="${icon}" alt="">
                <div class="meta">
                    <div class="name">${safeName}</div>
                    <div class="id">${safeId}</div>
                    <div class="author">${safeAuthor}</div>
                </div>
                <button class="btn danger" type="button">Delete</button>
            `;

            const btn = row.querySelector('button');
            btn.onclick = () => this.deleteAppFromRegistry(safeId);
            this.appsList.appendChild(row);
        }
    },

    async loadApps() {
        const token = this.tokenInput.value.trim();
        const repo = this.repoInput.value.trim();
        if (!token || !repo) {
            this.setManageMessage('Set your GitHub token and repo first.', 'error');
            return;
        }

        this.setManageMessage('Loading apps...', 'info');
        try {
            const file = await this.getRepoFile(repo, 'apps.json', token);
            if (!file.exists) {
                this.renderAppsManager([]);
                this.setManageMessage('apps.json not found in repo.', 'error');
                return;
            }
            const parsed = JSON.parse(file.text || '{}');
            const apps = (parsed && Array.isArray(parsed.apps)) ? parsed.apps : [];
            this.renderAppsManager(apps);
            this.setManageMessage(`Loaded ${apps.length} app(s).`, 'success');
        } catch (e) {
            this.setManageMessage('Failed to load apps: ' + (e && e.message ? e.message : 'Unknown error'), 'error');
        }
    },

    extractRepoPathFromRawUrl(repo, url) {
        if (!url || typeof url !== 'string') return null;
        // Supports .../main/<path> and .../master/<path>
        const re = new RegExp(`^https:\\/\\/raw\\.githubusercontent\\.com\\/${repo.replace('/', '\\/')}\\/(main|master)\\/(.+)$`);
        const m = url.match(re);
        return m ? m[2] : null;
    },

    async deleteAppFromRegistry(appId) {
        const token = this.tokenInput.value.trim();
        const repo = this.repoInput.value.trim();
        if (!token || !repo) {
            this.setManageMessage('Set your GitHub token and repo first.', 'error');
            return;
        }
        if (!appId) {
            this.setManageMessage('App id is missing; cannot delete.', 'error');
            return;
        }

        const alsoDeleteFiles = !!(this.deleteFilesCheckbox && this.deleteFilesCheckbox.checked);
        const confirmMsg = alsoDeleteFiles
            ? `Delete "${appId}" from apps.json and delete its ZIP/icon files from the repo?`
            : `Delete "${appId}" from apps.json?`;
        if (!confirm(confirmMsg)) return;

        this.setManageMessage('Deleting app...', 'info');

        try {
            const file = await this.getRepoFile(repo, 'apps.json', token);
            if (!file.exists) throw new Error('apps.json not found in repo');

            let parsed = {};
            try { parsed = JSON.parse(file.text || '{}'); } catch (e) { parsed = {}; }
            const apps = (parsed && Array.isArray(parsed.apps)) ? parsed.apps : [];
            const target = apps.find((a) => a && a.id === appId) || null;
            const nextApps = apps.filter((a) => !(a && a.id === appId));
            if (nextApps.length === apps.length) {
                this.setManageMessage('App not found in apps.json.', 'error');
                return;
            }

            if (alsoDeleteFiles && target) {
                const zipPath = this.extractRepoPathFromRawUrl(repo, target.download_url);
                const iconPath = this.extractRepoPathFromRawUrl(repo, target.icon);
                const msg = `Delete files for ${appId}`;
                if (zipPath) await this.deleteRepoFile(repo, zipPath, token, msg);
                if (iconPath) await this.deleteRepoFile(repo, iconPath, token, msg);
            }

            const updatedBase64 = btoa(JSON.stringify({ apps: nextApps }, null, 2));
            try {
                await this.putRepoFile(repo, 'apps.json', token, `Delete ${appId} from registry`, updatedBase64, file.sha);
            } catch (e) {
                const msg = (e && e.message) ? e.message : '';
                if (/does not match/i.test(msg) || /sha/i.test(msg)) {
                    const fresh = await this.getRepoFile(repo, 'apps.json', token);
                    const freshParsed = JSON.parse(fresh.text || '{}');
                    const freshApps = (freshParsed && Array.isArray(freshParsed.apps)) ? freshParsed.apps : [];
                    const filtered = freshApps.filter((a) => !(a && a.id === appId));
                    const freshBase64 = btoa(JSON.stringify({ apps: filtered }, null, 2));
                    await this.putRepoFile(repo, 'apps.json', token, `Delete ${appId} from registry`, freshBase64, fresh.sha);
                } else {
                    throw e;
                }
            }

            await this.loadApps();
            this.setManageMessage(`Deleted "${appId}".`, 'success');
        } catch (e) {
            this.setManageMessage('Delete failed: ' + (e && e.message ? e.message : 'Unknown error'), 'error');
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
