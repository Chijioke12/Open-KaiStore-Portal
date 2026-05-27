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

        this.deployHostedUrlInput = document.getElementById('deploy-hosted-url');
        this.fetchHostedBtn = document.getElementById('fetch-hosted-btn');
        this.hostedPreviewSection = document.getElementById('hosted-preview-section');
        this.hostedPreviewIcon = document.getElementById('hosted-preview-icon');
        this.hostedPreviewName = document.getElementById('hosted-preview-name');
        this.hostedPreviewDesc = document.getElementById('hosted-preview-desc');
        this.deployHostedBtn = document.getElementById('deploy-hosted-btn');

        this.statusSection = document.getElementById('status-section');
        this.statusMessage = document.getElementById('status-message');
        this.progressBar = document.getElementById('progress-bar');
        this.tokenInput = document.getElementById('gh-token');
        this.repoInput = document.getElementById('gh-repo');

        this.loadAppsBtn = document.getElementById('load-apps-btn');
        this.deleteFilesCheckbox = document.getElementById('delete-files-checkbox');
        this.manageMessage = document.getElementById('manage-message');
        this.appsList = document.getElementById('apps-list');

        this.hostedManifestUrlInput = document.getElementById('hosted-manifest-url');
        this.packagedZipUrlInput = document.getElementById('packaged-zip-url');
        this.installHostedBtn = document.getElementById('install-hosted-btn');
        this.installPackagedBtn = document.getElementById('install-packaged-btn');
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

        this.fetchHostedBtn.onclick = () => this.handleHostedFetch();
        this.deployHostedBtn.onclick = () => this.deployHosted();

        if (this.loadAppsBtn) {
            this.loadAppsBtn.onclick = () => this.loadApps();
        }

        if (this.installHostedBtn) {
            this.installHostedBtn.onclick = () => this.installFromUrl('hosted');
        }
        if (this.installPackagedBtn) {
            this.installPackagedBtn.onclick = () => this.installFromUrl('packaged');
        }
        
        this.tokenInput.onchange = () => this.saveConfig();
        this.repoInput.onchange = () => this.saveConfig();

        window.addEventListener('keydown', (e) => this.handleKeydown(e));
    },

    handleKeydown(e) {
        const focusables = Array.from(document.querySelectorAll('input, button, .drop-zone'));
        let index = focusables.indexOf(document.activeElement);

        switch(e.key) {
            case 'ArrowDown':
                index = (index + 1) % focusables.length;
                focusables[index].focus();
                e.preventDefault();
                break;
            case 'ArrowUp':
                index = (index - 1 + focusables.length) % focusables.length;
                focusables[index].focus();
                e.preventDefault();
                break;
            case 'Enter':
                if (document.activeElement === this.dropZone) {
                    this.zipInput.click();
                }
                break;
        }
    },

    saveConfig() {
        localStorage.setItem('gh-token', this.tokenInput.value);
        localStorage.setItem('gh-repo', this.repoInput.value);
    },

    loadConfig() {
        this.tokenInput.value = localStorage.getItem('gh-token') || '';
        this.repoInput.value = localStorage.getItem('gh-repo') || 'Chijioke12/Open-KaiStore-Registry';
        
        // Hide install section if not on KaiOS
        const installSection = document.getElementById('install-section');
        const androidNote = document.getElementById('android-note');
        if (!navigator.mozApps) {
            if (installSection) installSection.classList.add('hidden');
            if (androidNote) androidNote.classList.remove('hidden');
        }
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
        this.appMetadata = null; // Clear previous
        this.fileName.textContent = file.name;
        this.fileInfo.classList.remove('hidden');
        this.previewSection.classList.add('hidden');
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
                icons: manifest.icons,
                type: 'packaged'
            };

            // Extract the first available icon
            if (manifest.icons) {
                const iconSizes = Object.keys(manifest.icons).sort((a, b) => b - a);
                const bestIconPath = manifest.icons[iconSizes[0]];
                // Remove leading slash if present
                const cleanPath = bestIconPath.startsWith('/') ? (bestIconPath.slice(1)) : bestIconPath;
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

    async handleHostedFetch() {
        const url = this.deployHostedUrlInput.value.trim();
        if (!url) {
            alert('Please enter a manifest URL.');
            return;
        }

        this.appMetadata = null;
        this.hostedPreviewSection.classList.add('hidden');
        this.showStatus('Fetching manifest...', 'info');

        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const manifest = await res.json();

            this.appMetadata = {
                name: manifest.name,
                description: manifest.description,
                author: manifest.developer ? manifest.developer.name : 'Unknown',
                version: manifest.version,
                icons: manifest.icons,
                type: 'hosted',
                manifest_url: url
            };

            if (manifest.icons) {
                const iconSizes = Object.keys(manifest.icons).sort((a, b) => b - a);
                const iconUrl = manifest.icons[iconSizes[0]];
                // Resolve relative icon URL
                const absoluteIconUrl = new URL(iconUrl, url).href;
                this.hostedPreviewIcon.src = absoluteIconUrl;
                this.hostedPreviewIcon.classList.remove('hidden');
                this.appMetadata.iconUrl = absoluteIconUrl;
            }

            this.renderHostedPreview();
            this.statusSection.classList.add('hidden');
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

    renderHostedPreview() {
        this.hostedPreviewName.textContent = this.appMetadata.name;
        this.hostedPreviewDesc.textContent = this.appMetadata.description || 'No description provided.';
        this.hostedPreviewSection.classList.remove('hidden');
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
        const token = this.tokenInput.value.trim();
        const repo = this.repoInput.value.trim();

        if (!token || !repo) {
            alert('Please provide GitHub Token and Repo.');
            return;
        }

        this.showStatus('Connecting to GitHub...', 'info');
        this.updateProgress(10);

        try {
            // 1. Prepare files for atomic commit
            const filesToCommit = [];

            // A. ZIP File
            this.showStatus('Preparing ZIP...', 'info');
            const zipBase64 = await this.toBase64(this.zipFile);
            const zipPath = `apps/${this.appMetadata.name.replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').toLowerCase()}.zip`;
            const zipBlobSha = await this.createBlob(repo, token, zipBase64);
            filesToCommit.push({ path: zipPath, sha: zipBlobSha });
            this.updateProgress(30);

            // B. Icon
            let iconUrl = '';
            if (this.appMetadata.iconBlob) {
                this.showStatus('Preparing Icon...', 'info');
                const iconBase64 = await this.toBase64(this.appMetadata.iconBlob);
                const iconPath = `icons/${this.appMetadata.name.replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').toLowerCase()}-${this.appMetadata.iconName}`;
                const iconBlobSha = await this.createBlob(repo, token, iconBase64);
                filesToCommit.push({ path: iconPath, sha: iconBlobSha });
                iconUrl = `https://raw.githubusercontent.com/${repo}/main/${iconPath}`;
            }
            this.updateProgress(50);

            // C. Mini-Manifest
            this.showStatus('Preparing Mini-Manifest...', 'info');
            const appId = this.appMetadata.name.replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').toLowerCase();
            const miniManifest = {
                name: this.appMetadata.name,
                package_path: `https://raw.githubusercontent.com/${repo}/main/${zipPath}`,
                version: this.appMetadata.version || "1.0",
                developer: {
                    name: this.appMetadata.author || "Unknown"
                }
            };
            const manifestBase64 = "data:application/json;base64," + this.encodeUnicode(JSON.stringify(miniManifest, null, 2));
            const manifestPath = `manifests/${appId}.webapp`;
            const manifestBlobSha = await this.createBlob(repo, token, manifestBase64);
            filesToCommit.push({ path: manifestPath, sha: manifestBlobSha });
            this.updateProgress(70);

            // D. Updated apps.json
            this.showStatus('Updating Registry data...', 'info');
            const registryData = await this.getUpdatedRegistryData(repo, token, iconUrl, { 
                type: 'packaged',
                download_url: `https://raw.githubusercontent.com/${repo}/main/${zipPath}`
            });
            const registryBase64 = "data:application/json;base64," + registryData.base64;
            const registryBlobSha = await this.createBlob(repo, token, registryBase64);
            filesToCommit.push({ path: 'apps.json', sha: registryBlobSha });
            this.updateProgress(85);

            // 2. Commit all changes at once
            this.showStatus('Committing changes to GitHub...', 'info');
            await this.commitChanges(repo, token, 'main', `Deploy ${this.appMetadata.name}`, filesToCommit);
            this.updateProgress(100);

            this.showStatus('Success! App deployed atomically to your store.', 'success');
        } catch (err) {
            this.showStatus('Deployment failed: ' + err.message, 'error');
        }
    },

    async createBlob(repo, token, base64WithPrefix) {
        const content = base64WithPrefix.includes(',') ? base64WithPrefix.split(',')[1] : base64WithPrefix;
        const res = await fetch(`https://api.github.com/repos/${repo}/git/blobs`, {
            method: 'POST',
            headers: {
                'Authorization': `token ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ content, encoding: 'base64' })
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err && err.message ? err.message : `Blob creation failed: ${res.status}`);
        }
        const data = await res.json();
        return data.sha;
    },

    async commitChanges(repo, token, branch, message, files) {
        // 1. Get current branch reference
        const refUrl = `https://api.github.com/repos/${repo}/git/refs/heads/${branch}?t=${Date.now()}`;
        const refRes = await fetch(refUrl, { headers: { 'Authorization': `token ${token}` } });
        if (!refRes.ok) throw new Error('Failed to get branch ref');
        const refData = await refRes.json();
        const baseCommitSha = refData.object.sha;

        // 2. Get current commit's tree
        const commitUrl = `https://api.github.com/repos/${repo}/git/commits/${baseCommitSha}`;
        const commitRes = await fetch(commitUrl, { headers: { 'Authorization': `token ${token}` } });
        if (!commitRes.ok) throw new Error('Failed to get base commit');
        const commitData = await commitRes.json();
        const baseTreeSha = commitData.tree.sha;

        // 3. Create a new tree (as a delta from base tree)
        const treeItems = files.map(f => ({
            path: f.path,
            mode: '100644',
            type: 'blob',
            sha: f.sha
        }));
        const treeRes = await fetch(`https://api.github.com/repos/${repo}/git/trees`, {
            method: 'POST',
            headers: {
                'Authorization': `token ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                base_tree: baseTreeSha,
                tree: treeItems
            })
        });
        if (!treeRes.ok) throw new Error('Failed to create new tree');
        const treeData = await treeRes.json();
        const newTreeSha = treeData.sha;

        // 4. Create the commit
        const newCommitRes = await fetch(`https://api.github.com/repos/${repo}/git/commits`, {
            method: 'POST',
            headers: {
                'Authorization': `token ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message,
                tree: newTreeSha,
                parents: [baseCommitSha]
            })
        });
        if (!newCommitRes.ok) throw new Error('Failed to create new commit');
        const newCommitData = await newCommitRes.json();
        const newCommitSha = newCommitData.sha;

        // 5. Update the reference
        const updateRefRes = await fetch(`https://api.github.com/repos/${repo}/git/refs/heads/${branch}`, {
            method: 'PATCH',
            headers: {
                'Authorization': `token ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ sha: newCommitSha })
        });
        if (!updateRefRes.ok) {
            const err = await updateRefRes.json().catch(() => ({}));
            // If conflict (someone else pushed), retry once with fresh data
            if (updateRefRes.status === 422) {
                return this.commitChanges(repo, token, branch, message, files);
            }
            throw new Error(err && err.message ? err.message : 'Failed to update branch ref');
        }
    },

    async getUpdatedRegistryData(repo, token, iconUrl, extra) {
        const path = 'apps.json';

        const getPagesManifestUrl = (appId) => {
            const parts = (repo || '').split('/');
            if (parts.length !== 2) return '';
            const owner = parts[0];
            const repoName = parts[1];
            return `https://${owner}.github.io/${repoName}/manifests/${appId}.webapp`;
        };

        const fetchAppsJson = async () => {
            const rawUrl = `https://api.github.com/repos/${repo}/contents/${path}?t=${Date.now()}`;
            const res = await fetch(rawUrl, { headers: { 'Authorization': `token ${token}` } });
            let apps = [];
            if (res.ok) {
                const data = await res.json();
                const content = data.content ? this.decodeUnicode(data.content) : '';
                try {
                    apps = JSON.parse(content).apps || [];
                } catch (e) { apps = []; }
            }
            return apps;
        };

        const apps = await fetchAppsJson();
        const appId = this.appMetadata.name.replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').toLowerCase();
        const appEntry = {
            id: appId,
            name: this.appMetadata.name,
            author: this.appMetadata.author,
            description: this.appMetadata.description,
            icon: iconUrl,
            type: extra.type,
            ...extra
        };

        if (extra.type === 'packaged' && !appEntry.manifest_url) {
            appEntry.manifest_url = getPagesManifestUrl(appId);
        }

        const existingIndex = apps.findIndex(a => a && a.id === appEntry.id);
        if (existingIndex > -1) {
            apps[existingIndex] = appEntry;
        } else {
            apps.push(appEntry);
        }

        const newContent = JSON.stringify({ apps: apps }, null, 2);
        return {
            text: newContent,
            base64: this.encodeUnicode(newContent)
        };
    },

    async deployHosted() {
        const token = this.tokenInput.value.trim();
        const repo = this.repoInput.value.trim();

        if (!token || !repo) {
            alert('Please provide GitHub Token and Repo.');
            return;
        }

        this.showStatus('Updating Registry...', 'info');
        this.updateProgress(50);

        try {
            await this.updateRegistry(repo, token, this.appMetadata.iconUrl, {
                type: 'hosted',
                manifest_url: this.appMetadata.manifest_url
            });
            this.updateProgress(100);
            this.showStatus('Success! Hosted app registered in your store.', 'success');
        } catch (err) {
            this.showStatus('Deployment failed: ' + err.message, 'error');
        }
    },

    async uploadToGitHub(repo, path, content, token) {
        const getSha = async () => {
            try {
                const rawUrl = `https://api.github.com/repos/${repo}/contents/${path}?t=${Date.now()}`;
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
        const url = `https://api.github.com/repos/${repo}/contents/${path}?t=${Date.now()}`;
        const res = await fetch(url, { headers: { 'Authorization': `token ${token}` } });
        if (res.status === 404) return { exists: false, sha: null, text: '' };
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err && err.message ? err.message : `HTTP ${res.status}`);
        }
        const data = await res.json();
        const content = data && data.content ? this.decodeUnicode(data.content) : '';
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
        const url = `https://api.github.com/repos/${repo}/contents/${path}?t=${Date.now()}`;
        const getRes = await fetch(url, { headers: { 'Authorization': `token ${token}` } });
        if (getRes.status === 404) return;
        if (!getRes.ok) {
            const err = await getRes.json().catch(() => ({}));
            throw new Error(err && err.message ? err.message : 'Unknown error');
        }
        const data = await getRes.json();
        const sha = data && data.sha ? data.sha : null;
        if (!sha) return;

        const delRes = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
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

    async updateRegistry(repo, token, iconUrl, extra) {
        this.showStatus('Updating Registry...', 'info');
        try {
            const apps = await this.fetchAppsJson(repo, token);
            const appId = this.appMetadata.name.replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').toLowerCase();
            
            const appEntry = {
                id: appId,
                name: this.appMetadata.name,
                author: this.appMetadata.author,
                description: this.appMetadata.description,
                icon: iconUrl,
                type: extra.type,
                ...extra
            };

            const getPagesManifestUrl = (id) => {
                const parts = (repo || '').split('/');
                if (parts.length !== 2) return '';
                // Use raw.githack.com proxy instead of github.io
                // This completely bypasses the need to enable GitHub Pages
                return `https://raw.githack.com/${parts[0]}/${parts[1]}/main/manifests/${id}.webapp`;
            };

            if (extra.type === 'packaged' && !appEntry.manifest_url) {
                appEntry.manifest_url = getPagesManifestUrl(appId);
            }

            const existingIndex = apps.findIndex(a => a && a.id === appEntry.id);
            if (existingIndex > -1) {
                apps[existingIndex] = appEntry;
            } else {
                apps.push(appEntry);
            }

            const newContent = JSON.stringify({ apps: apps }, null, 2);
            const registryBase64 = "data:application/json;base64," + this.encodeUnicode(newContent);
            const registryBlobSha = await this.createBlob(repo, token, registryBase64);
            
            await this.commitChanges(repo, token, 'main', `Registry Update: ${this.appMetadata.name}`, [{
                path: 'apps.json',
                sha: registryBlobSha
            }]);

            this.updateProgress(100);
            this.showStatus(`Success! ${extra.type === 'hosted' ? 'Hosted' : 'Packaged'} app registered.`, 'success');
        } catch (err) {
            this.showStatus('Registry update failed: ' + err.message, 'error');
            throw err;
        }
    },

    async fetchAppsJson(repo, token) {
        const rawUrl = `https://api.github.com/repos/${repo}/contents/apps.json?t=${Date.now()}`;
        const res = await fetch(rawUrl, { headers: { 'Authorization': `token ${token}` } });
        if (!res.ok) return [];
        const data = await res.json();
        try {
            return JSON.parse(this.decodeUnicode(data.content)).apps || [];
        } catch (e) { return []; }
    },

    async deleteAppFromRegistry(appId) {
        const token = this.tokenInput.value.trim();
        const repo = this.repoInput.value.trim();
        if (!token || !repo) {
            this.setManageMessage('Set your GitHub token and repo first.', 'error');
            return;
        }
        
        const alsoDeleteFiles = !!(this.deleteFilesCheckbox && this.deleteFilesCheckbox.checked);
        if (!confirm(`Delete "${appId}" from apps.json${alsoDeleteFiles ? ' and delete associated files?' : '?'}`)) return;

        this.setManageMessage('Deleting app...', 'info');

        try {
            const apps = await this.fetchAppsJson(repo, token);
            const target = apps.find(a => a && a.id === appId);
            const nextApps = apps.filter(a => !(a && a.id === appId));

            // 1. Prepare registry update
            const registryContent = JSON.stringify({ apps: nextApps }, null, 2);
            const registryBase64 = "data:application/json;base64," + this.encodeUnicode(registryContent);
            const registryBlobSha = await this.createBlob(repo, token, registryBase64);
            
            const filesToCommit = [{ path: 'apps.json', sha: registryBlobSha }];

            // 2. Perform atomic commit for registry
            await this.commitChanges(repo, token, 'main', `Registry Delete: ${appId}`, filesToCommit);

            // 3. Delete files individually
            if (alsoDeleteFiles && target) {
                const paths = [
                    this.extractRepoPathFromRawUrl(repo, target.download_url),
                    this.extractRepoPathFromRawUrl(repo, target.icon),
                    target.type === 'packaged' ? this.extractRepoPathFromRawUrl(repo, target.manifest_url) : null
                ].filter(Boolean);

                for (const path of paths) await this.deleteRepoFile(repo, path, token, `Delete ${appId} files`);
            }

            await this.loadApps();
            this.setManageMessage(`Deleted "${appId}".`, 'success');
        } catch (e) {
            this.setManageMessage('Delete failed: ' + (e && e.message ? e.message : 'Unknown error'), 'error');
        }
    },

    installFromUrl(type) {
        try {
            if (!navigator.mozApps) {
                alert('mozApps API not available on this device/browser.');
                return;
            }

            const url = type === 'hosted'
                ? (this.hostedManifestUrlInput ? this.hostedManifestUrlInput.value.trim() : '')
                : (this.packagedZipUrlInput ? this.packagedZipUrlInput.value.trim() : '');

            if (!url) {
                alert('Please provide a URL first.');
                return;
            }

            const method = type === 'hosted' ? 'install' : 'installPackage';
            const fn = navigator.mozApps[method];
            if (typeof fn !== 'function') {
                alert(`navigator.mozApps.${method} is not supported on this device.`);
                return;
            }

            const req = fn.call(navigator.mozApps, url);
            req.onsuccess = () => alert('Installation started.');
            req.onerror = function() {
                const name = this.error && this.error.name ? this.error.name : 'UnknownError';
                alert('Installation failed: ' + name);
            };
        } catch (e) {
            alert('Installation failed: ' + (e && e.message ? e.message : String(e)));
        }
    },

    encodeUnicode(str) {
        return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (match, p1) => {
            return String.fromCharCode('0x' + p1);
        }));
    },

    decodeUnicode(str) {
        return decodeURIComponent(Array.prototype.map.call(atob(str.replace(/\s/g, '')), (c) => {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
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
