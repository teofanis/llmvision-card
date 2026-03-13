import { translate, hexToRgba } from './helpers.js?v=1.6.0';

const __LLMVISION_VERSION = 'v1.6.0';
function __logLLMVisionBadge(context) {
    if (!window.__LLMVISION_BADGE_LOGGED) {
        console.log(
            '%cLLM Vision Card%c%c' + __LLMVISION_VERSION,
            'background:#0071FF;color:#fff;padding:2px 6px 2px 8px;border-radius:4px 0 0 4px;font-weight:600;',
            'background:#0058c7;color:#fff;padding:2px 4px;font-weight:500;',
            'background:#0058c7;color:#fff;padding:2px 8px 2px 6px;border-radius:0 4px 4px 0;font-weight:600;'
        );
        window.__LLMVISION_BADGE_LOGGED = true;
    }
}

export class BaseLLMVisionCard extends HTMLElement {
    imageCache = new Map();
    _lastEventHash = null;

    connectedCallback() {
        if (!this._badgeLogged) {
            __logLLMVisionBadge(this.badgeContext || 'Card');
            this._badgeLogged = true;
        }
    }

    setCommonConfig(config, { requireEventLimits = false } = {}) {
        this.config = config;
        this.category_filters = config.category_filters || [];
        this.camera_filters = config.camera_filters || [];
        this.language = config.language;
        this.number_of_events = config.number_of_events;
        this.number_of_days = config.number_of_days;
        this.custom_colors = config.custom_colors || {};
        this.default_icon = config.default_icon || 'mdi:motion-sensor';
        this.default_color = config.default_color || '#929292';
        this.time_format = config.time_format || '24h';
        this.filter_false_positives = config.filter_false_positives !== false;
        if (requireEventLimits) {
            if (!this.number_of_events && !this.number_of_days) {
                throw new Error('Either number_of_events or number_of_days needs to be set.');
            }
            if (this.number_of_events && this.number_of_events < 1) {
                throw new Error('number_of_events must be greater than 0.');
            }
        }
    }

    async fetchEvents(hass, limit = 10, days = 7, cameras = [], categories = []) {
        try {
            const params = new URLSearchParams();
            if (limit) params.set('limit', limit);
            if (cameras?.length) {
                params.set('cameras', cameras.join(','));
            }
            if (days) params.set('days', days);
            if (categories?.length) {
                params.set('categories', categories.join(','));
            }

            const path = `llmvision/timeline/events${params.toString() ? '?' + params.toString() : ''}`;
            const data = await hass.callApi('GET', path);
            const items = Array.isArray(data?.events) ? data.events : [];

            return items.map((item) => {
                const cameraEntityId = item.camera_name || '';
                const cameraEntity = cameraEntityId ? hass.states[cameraEntityId] : undefined;
                const cameraFriendlyName = cameraEntity ? (cameraEntity.attributes?.friendly_name || cameraEntityId) : '';
                return {
                    title: item.title || '',
                    description: item.description || '',
                    category: item.category || '',
                    label: item.label || '',
                    keyFrame: (item.key_frame || ''),
                    cameraName: cameraFriendlyName,
                    startTime: item.start || null,
                    endTime: item.end || null,
                    id: item.uid || '',
                };
            });
        } catch (err) {
            console.error('Error fetching events from API:', err);
            return null;
        }
    }

    async deleteEvent(hass, eventId) {
        try {
            await hass.callApi('DELETE', `llmvision/timeline/event/${encodeURIComponent(eventId)}`);
            return true;
        } catch (err) {
            console.error('Error deleting event from API:', err);
            return false;
        }
    }

    _hashState(base) {
        return JSON.stringify(base);
    }

    _filterNoActivity(details) {
        return details.filter((d) => (d?.title || '').trim().toLowerCase() !== 'no activity observed');
    }

    _filterByHours(details, hours) {
        if (!hours) return details;
        const cutoff = Date.now() - hours * 3600 * 1000;
        return details.filter(d => new Date(d.startTime).getTime() >= cutoff);
    }

    _filterByCategories(details) {
        if (!this.category_filters?.length) return details;
        return details.filter(d => {
            if (!d.category) return false;
            return this.category_filters.includes(d.category);
        });
    }

    _filterByCameras(details) {
        if (!this.camera_filters?.length) return details;
        return details.filter(d => {
            if (!d.cameraEntityId) return true;
            return this.camera_filters.includes(d.cameraEntityId);
        });
    }

    _applyAllFilters(details) {
        let res = details;
        if (this.filter_false_positives) {
            res = this._filterNoActivity(res);
        }
        res = this._filterByCategories(res);
        res = this._filterByCameras(res);
        return res;
    }

    _sort(details) {
        return details.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
    }

    _limit(details) {
        if (this.number_of_days) {
            // number_of_events acts as secondary limiter only after hours filter
            if (this.number_of_events) return details.slice(0, this.number_of_events);
            return details;
        }
        if (this.number_of_events) return details.slice(0, this.number_of_events);
        return details;
    }

    formatDateLabel(dateObj) {
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);
        if (dateObj.toDateString() === today.toDateString()) return translate('today', this.language) || "Today";
        if (dateObj.toDateString() === yesterday.toDateString()) return translate('yesterday', this.language) || "Yesterday";
        return dateObj.toLocaleDateString('en', { month: 'short', day: 'numeric' });
    }

    formatTime(dateObj) {
        const format = this.time_format || '24h';
        const minutes = dateObj.getMinutes().toString().padStart(2, '0');
        if (format === '12h') {
            const hours = dateObj.getHours();
            const normalized = hours % 12 || 12;
            const suffix = hours >= 12 ? 'PM' : 'AM';
            return `${normalized.toString().padStart(2, '0')}:${minutes} ${suffix}`;
        }
        return `${dateObj.getHours().toString().padStart(2, '0')}:${minutes}`;
    }

    formatDateTimeShort(dateStr) {
        const date = new Date(dateStr);
        const today = new Date();
        const yesterday = new Date();
        yesterday.setDate(today.getDate() - 1);
        const options = { month: 'short', day: 'numeric' };
        if (date.toDateString() === today.toDateString()) {
            return translate('today', this.language) || "Today";
        } else if (date.toDateString() === yesterday.toDateString()) {
            return translate('yesterday', this.language) || "Yesterday";
        }
        return date.toLocaleDateString('en-US', options);
    }

    formatDateTimeFull(dateStr) {
        const d = new Date(dateStr);
        const options = { month: 'short', day: 'numeric' };
        const datePart = d.toLocaleDateString('en-US', options);
        const timePart = this.formatTime(d);
        return `${datePart}, ${timePart}`;
    }

    resolveKeyFrame(hass, keyFrame) {
        if (!keyFrame) return Promise.resolve('');
        if (/^https?:\/\//i.test(keyFrame)) return Promise.resolve(keyFrame);
        const mediaContentID = keyFrame.replace('/media/', 'media-source://media_source/local/');
        if (this.imageCache.has(mediaContentID)) {
            return Promise.resolve(this.imageCache.get(mediaContentID));
        }
        return hass.callWS({
            type: "media_source/resolve_media",
            media_content_id: mediaContentID,
            expires: 60 * 60 * 3
        }).then(result => {
            const url = result.url;
            this.imageCache.set(mediaContentID, url);
            return url;
        }).catch(err => {
            console.error("Error resolving media content ID:", err);
            return keyFrame;
        });
    }

    computeColors(category, defaultColor) {
        const customColors = this.custom_colors || {};
        let color;
        if (category === undefined || category === null) {
            if (this.default_color !== undefined) color = this.default_color;
            else color = defaultColor;
        } else {
            color = (customColors[category] !== undefined) ? customColors[category] : defaultColor;
        }
        let bgColorRgba, iconColorRgba;
        if (Array.isArray(color) && color.length === 3) {
            bgColorRgba = `rgba(${color[0]},${color[1]},${color[2]},0.2)`;
            iconColorRgba = `rgba(${color[0]},${color[1]},${color[2]},1)`;
        } else {
            bgColorRgba = hexToRgba(color, 0.2);
            iconColorRgba = hexToRgba(color, 1);
        }
        return { bgColorRgba, iconColorRgba };
    }

    showPopup({ event, summary, startTime, keyFrame, cameraName, category, label, icon, prefix, eventId }, hassArg) {
        const hass = hassArg || this.hass;
        const formattedTime = this.formatDateTimeFull(startTime);
        const secondaryText = cameraName ? `${formattedTime} • ${cameraName}` : formattedTime;
        const overlayClass = `${prefix}-overlay`;
        const contentClass = `${prefix}-content`;
        const closeBtnClass = `close-${prefix}`;
        // New menu-related classes
        const headerRowClass = `${prefix}-header-row`;
        const titleRowClass = `${prefix}-title-row`;
        const menuWrapperClass = `${prefix}-menu`;
        const menuBtnClass = `${prefix}-menu-btn`;
        const menuListClass = `${prefix}-menu-list`;
        const menuItemClass = `${prefix}-menu-item`;
        const menuDeleteClass = `${prefix}-menu-item-delete`;
        const menuThumbUpClass = `${prefix}-menu-item-thumbs-up`;
        const menuThumbDownClass = `${prefix}-menu-item-thumbs-down`;

        const normalize = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value);
        const shouldShowCategory = Boolean(category && !(label && normalize(label) === normalize(category)));

        const htmlBlock = `
                <div>
                    <div class="${headerRowClass}">
                        <button class="${closeBtnClass}" title="Close" style="font-size:30px">
                            <ha-icon icon="mdi:close"></ha-icon>
                        </button>
                        <div class="spacer"></div>
                        ${eventId ? `
                            <div class="${menuWrapperClass}">
                            <button class="${menuBtnClass}" title="Menu" style="font-size:26px">
                                <ha-icon icon="mdi:dots-vertical"></ha-icon>
                            </button>
                            <div class="${menuListClass}" hidden>
                                <div class="${prefix}-menu-rate-row">
                                    <button class="${menuItemClass} ${menuThumbUpClass}" title="Good response">
                                        <ha-icon icon="mdi:thumb-up-outline"></ha-icon>
                                    </button>
                                    <button class="${menuItemClass} ${menuThumbDownClass}" title="Bad response">
                                        <ha-icon icon="mdi:thumb-down-outline"></ha-icon>
                                    </button>
                                </div>
                                <button class="${menuItemClass} ${menuDeleteClass}" title="Delete event">
                                    <ha-icon icon="mdi:trash-can-outline"></ha-icon>
                                    <span>${translate('delete', this.language) || 'Delete'}</span>
                                </button>
                            </div>
                        </div>` : ''}
                    </div>
                    <div class="${titleRowClass}">
                        <div class="${prefix}-title-main">
                            <h2>${event}</h2>
                        </div>
                        <div class="${prefix}-title-secondary">
                            <p class="secondary"><span>${secondaryText}</span></p>
                        </div>
                        <div class="${prefix}-title-tertiary">
                            <div class="${prefix}-badges-row">
                                ${shouldShowCategory ? `
                                <span class="${prefix}-badge">
                                    <ha-icon icon="mdi:label"></ha-icon>
                                    <span class="text" style="text-transform: capitalize;">${category}</span>
                                </span>` : ''}
                                ${label ? `
                                <span class="${prefix}-badge">
                                    <ha-icon icon="${icon || 'mdi:tag-outline'}"></ha-icon>
                                    <span class="text" style="text-transform: capitalize;">${label}</span>
                                </span>` : ''}
                            </div>
                        </div>
                    </div>
                    <img src="${keyFrame}" alt="Event Snapshot" onerror="this.style.display='none'">
                    <p class="summary">${summary}</p>
                </div>
            `;

        const wrapper = document.createElement('div');
        wrapper.innerHTML = `
                <div class="${overlayClass}">
                    <div class="${contentClass}">
                        ${htmlBlock}
                    </div>
                </div>
                <style>
                    .${overlayClass} {
                        position: fixed;
                        inset: 0;
                        background: rgba(0,0,0,0.5);
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        z-index: 1000;
                        opacity: 0;
                        transition: opacity 0.2s ease;
                    }
                    .${overlayClass}.show { opacity: 1; }
                    .${contentClass} {
                        position: relative;
                        background: var(--ha-card-background, var(--card-background-color, #f3f3f3));
                        color: var(--primary-text-color);
                        padding: 20px;
                        border-radius: var(--ha-card-border-radius, 25px);
                        max-width: 500px;
                        width: 100%;
                        max-height: 80vh;
                        overflow-y: auto;
                        transform: scale(0.9);
                        transition: transform 0.2s ease;
                    }
                    .${overlayClass}.show .${contentClass} { transform: scale(1); }
    
                    .${headerRowClass} {
                        display: flex;
                        align-items: center;
                        gap: 8px;
                        margin-bottom: 4px;
                    }
                    .${headerRowClass} .spacer {
                        flex: 1 1 auto;
                    }
    
                    /* Title row: icon + title */
                    .${titleRowClass} {
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        gap: 6px;
                        margin-bottom: 6px;
                    }
                    .${prefix}-title-main {
                        display: flex;
                        align-items: center;
                        gap: 10px;
                        justify-content: center;
                        width: 100%;
                    }
                    .${prefix}-title-main h2 {
                        flex: 1 1 auto;
                        min-width: 0;
                        max-width: 100%;
                        overflow: visible;
                        white-space: normal;
                        word-break: break-word;
                        margin: 0;
                        font-family: var(--ha-font-family-heading, "Roboto");
                        text-align: center;
                    }
                    .${prefix}-title-secondary {
                        width: 100%;
                        text-align: center;
                    }
                    .${prefix}-title-secondary .secondary {
                        font-weight: var(--ha-font-weight-medium, 500);
                        margin-top: 4px;
                        color: var(--primary-text-color);
                        font-family: var(--ha-font-family-body, "Roboto");
                    }
                    .${prefix}-title-tertiary {
                        width: 100%;
                        display: flex;
                        justify-content: center;
                    }
                    .${prefix}-badges-row {
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        flex-wrap: wrap;
                        gap: 8px;
                        width: 100%;
                    }
                    .${prefix}-badge {
                        display: inline-flex;
                        align-items: center;
                        gap: 6px;
                        padding: 4px 10px;
                        border-radius: 9px;
                        background: var(--table-header-background-color, rgba(0,0,0,0.08));
                        color: var(--primary-text-color);
                        font-size: 0.9em;
                        line-height: 1;
                    }
                    .${prefix}-badge ha-icon {
                        --mdc-icon-size: 18px;
                    }
    
                    /* Image and text */
                    .${contentClass} img {
                        width: 100%;
                        height: auto;
                        border-radius: calc(var(--ha-card-border-radius, 25px) - 10px);
                        margin-top: 10px;
                    }
                    .${contentClass} .summary {
                        color: var(--secondary-text-color);
                        font-size: var(--ha-font-size-l, 16px);
                        line-height: 22px;
                        font-family: var(--ha-font-family-body, "Roboto");
                    }
    
                    /* Buttons */
                    .${closeBtnClass}, .${menuBtnClass} {
                        background: none;
                        border: none;
                        cursor: pointer;
                        color: var(--primary-text-color);
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                    }
    
                    /* Menu */
                    .${menuWrapperClass} {
                        position: relative;
                    }
                    .${menuListClass} {
                        position: absolute;
                        right: 0;
                        top: calc(100% + 6px);
                        background: var(--ha-card-background, var(--card-background-color, #f3f3f3));
                        color: var(--primary-text-color);
                        border-radius: 10px;
                        box-shadow: 0 6px 18px rgba(0,0,0,0.2);
                        padding: 6px;
                        min-width: 160px;
                        z-index: 10;
                    }
                    .${prefix}-menu-rate-row {
                        display: flex;
                        gap: 8px;
                        align-items: center;
                        margin-bottom: 6px;
                        width: 100%;
                    }
                    .${menuItemClass}.${menuThumbUpClass}, .${menuItemClass}.${menuThumbDownClass} {
                        flex: 1 1 0;
                        min-width: 0;
                        padding: 8px 12px;
                        justify-content: center;
                        box-sizing: border-box;
                    }
                    .${menuItemClass} {
                        width: 100%;
                        display: flex;
                        align-items: center;
                        gap: 10px;
                        background: none;
                        border: none;
                        color: inherit;
                        cursor: pointer;
                        padding: 8px 10px;
                        border-radius: 8px;
                    }
                    .${menuItemClass}:hover {
                        background: rgba(0,0,0,0.06);
                    }
                    .${menuDeleteClass} {
                        color: var(--error-color, #d32f2f);
                    }
                    .${menuThumbUpClass} {
                        padding: 6px !important;
                    }
                    .${menuThumbDownClass} {
                        padding: 6px !important;
                    }
    
                    @media (max-width: 768px) {
                        .${contentClass} {
                            max-width: 100%;
                            max-height: 100%;
                            padding: 15px;
                            border-radius: 0;
                            height: 100%;
                        }
                        .${headerRowClass} {
                            padding-top: 10px;
                        }
                        .${prefix}-title-main h2 {
                            max-width: 78%;
                            overflow: hidden;
                            text-overflow: ellipsis;
                            white-space: nowrap;
                            margin: 0;
                            font-family: var(--ha-font-family-heading, "Roboto");
                            text-align: center;
                        }
                    }
                </style>
            `;

        if (!history.state || !history.state.popupOpen) {
            history.pushState({ popupOpen: true }, '');
        }
        const overlayEl = wrapper.querySelector(`.${overlayClass}`);
        const popstateHandler = () => this.closePopup(wrapper, overlayClass, popstateHandler);
        window.addEventListener('popstate', popstateHandler);
        wrapper.querySelector(`.${closeBtnClass}`).addEventListener('click', () =>
            this.closePopup(wrapper, overlayClass, popstateHandler)
        );
        overlayEl.addEventListener('click', (ev) => {
            if (ev.target === overlayEl) this.closePopup(wrapper, overlayClass, popstateHandler);
        });
        const escHandler = (ev) => {
            if (ev.key === 'Escape') this.closePopup(wrapper, overlayClass, popstateHandler, escHandler);
        };
        document.addEventListener('keydown', escHandler);
        wrapper._escHandler = escHandler;

        // Menu toggle and outside-click close
        const menuBtn = wrapper.querySelector(`.${menuBtnClass}`);
        const menuList = wrapper.querySelector(`.${menuListClass}`);
        if (menuBtn && menuList) {
            menuBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                menuList.hidden = !menuList.hidden;
            });
            wrapper.addEventListener('click', (e) => {
                if (!menuList.hidden && !e.target.closest(`.${menuWrapperClass}`)) {
                    menuList.hidden = true;
                }
            });
        }

        // Wire up Delete inside menu
        const deleteItem = wrapper.querySelector(`.${menuDeleteClass}`);
        if (deleteItem && eventId) {
            deleteItem.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (deleteItem.disabled) return;
                const confirmMsg = translate('confirm_delete_event', this.language) || "Are you sure you want to delete this event?";
                if (!confirm(confirmMsg)) {
                    if (menuList) menuList.hidden = true;
                    return;
                }
                deleteItem.disabled = true;
                const success = await this.deleteEvent(hass, eventId);
                if (success) {
                    this.closePopup(wrapper, overlayClass, popstateHandler, escHandler);
                } else {
                    alert(translate('error_delete_event', this.language) || "Failed to delete the event. Please try again.");
                    deleteItem.disabled = false;
                    if (menuList) menuList.hidden = true;
                }
            });
        }

        // Wire up thumbs up / thumbs down inside menu
        const thumbsUpItem = wrapper.querySelector(`.${menuThumbUpClass}`);
        const thumbsDownItem = wrapper.querySelector(`.${menuThumbDownClass}`);
        const sendFeedback = async (feedback, el, reason, userFeedbackText, correctedTitle = '', correctedDescription = '') => {
            if (el.disabled) return;
            el.disabled = true;
            const eventDetail = { eventId, feedback };
            this.dispatchEvent(new CustomEvent('llmvision-feedback', { detail: eventDetail, bubbles: true, composed: true }));

            // Prepare metadata to send
            const metadata = {
                title: event || '',
                description: summary || '',
                label: label || '',
                category: category || '',
                icon: icon || this.default_icon || '',
                eventId: eventId || '',
                startTime: startTime || ''
            };

            try {
                // Only attempt upload if we have a keyFrame URL
                if (keyFrame) {
                    let blob;
                    if (keyFrame.startsWith('data:')) {
                        const res = await fetch(keyFrame);
                        blob = await res.blob();
                    } else {
                        const res = await fetch(keyFrame, { mode: 'cors' });
                        blob = await res.blob();
                    }

                    const contentType = blob.type || 'image/jpeg';
                    const ext = contentType.split('/')[1] || 'jpg';
                    const filename = `event_${eventId || Date.now()}.${ext}`;

                    // Send request to feedback API
                    const app_key = 'e2d892b226e34339940079041ebc65fed345a5cdbd888b6f042ec2c44e0f9a2a';
                    try {
                        const form = new FormData();
                        form.append('image', blob, filename);
                        form.append('isTitle', metadata.title || '');
                        form.append('shouldBeTitle', correctedTitle || event || '');
                        form.append('isDescription', metadata.description || '');
                        form.append('shouldBeDescription', correctedDescription || summary || '');
                        form.append('isLabel', metadata.label || '');
                        form.append('shouldBeLabel', label || '');
                        form.append('isCategory', metadata.category || '');
                        form.append('shouldBeCategory', category || '');
                        form.append('isIcon', metadata.icon || '');
                        form.append('shouldBeIcon', icon || '');
                        form.append('upDown', feedback || '');
                        form.append('reason', reason || '');
                        // Include any additional feedback provided by the user
                        form.append('feedback', userFeedbackText || '');

                        const res = await fetch('https://feedback.llmvision.org/', {
                            method: 'POST',
                            headers: {
                                'X-App-Key': app_key
                            },
                            body: form,
                            mode: 'cors'
                        });

                        if (!res.ok) {
                            const text = await res.text().catch(() => '');
                            console.error('Feedback upload failed:', res.status, text);
                        } else {
                            console.log('Feedback uploaded successfully');
                        }
                    } catch (err) {
                        console.error('Error uploading snapshot to feedback API:', err);
                    }

                }
            } catch (err) {
                console.error('Error uploading snapshot to feedback API:', err);
            } finally {
                this.closePopup(wrapper, overlayClass, popstateHandler, escHandler);
            }
        };
        // Opens a multi-page feedback-detail flow (reason -> conditional page -> details)
        const openFeedbackDetail = (feedback, el) => {
            if (el.disabled) return;
            const fdOverlayClass = `${prefix}-feedback-detail-overlay`;
            const fdContentClass = `${prefix}-feedback-detail-content`;
            const fdWrapper = document.createElement('div');

            // Page templates
            const reasons = [
                { value: 'event_not_no_activity', label: `Event is not 'no activity'` },
                { value: 'event_is_no_activity', label: `Event should be 'no activity'` },
                { value: 'title_inaccurate', label: 'Title is not accurate' },
                { value: 'description_inaccurate', label: 'Description is not accurate' },
                { value: 'incorrect_label', label: 'Incorrect label' },
                { value: 'incorrect_category', label: 'Incorrect category' },
                { value: 'other', label: 'Other' }
            ];

            fdWrapper.innerHTML = `
                <div class="${fdOverlayClass}">
                    <div class="${fdContentClass}">
                        <button class="${prefix}-fd-close" title="Close" aria-label="Close" style="font-size:20px">✕</button>
                            <div class="${prefix}-fd-page ${prefix}-fd-page-1">
                                <h2>${translate('feedback_reason', this.language) || 'Select reason'}</h2>
                                <div class="${prefix}-fd-reason-list">
                                    ${reasons.map(r => `
                                        <button type="button" class="${prefix}-fd-reason-btn" data-value="${r.value}">${r.label}</button>
                                    `).join('')}
                                </div>
                            </div>

                        <div class="${prefix}-fd-page ${prefix}-fd-page-2" hidden>
                            <!-- dynamic second page: for event_not_no_activity show title+description, otherwise show a short note -->
                            <div class="${prefix}-fd-page-2-content" style="margin-top:24px"></div>
                            <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">
                                <button class="${prefix}-fd-next-2">${translate('next', this.language) || 'Next'}</button>
                            </div>
                        </div>

                        <div class="${prefix}-fd-page ${prefix}-fd-page-3" hidden>
                            <h2>${translate('additional_details', this.language) || 'Additional details'}</h2>
                            <textarea class="${prefix}-fd-final-details" rows="6" style="width:100%;padding:8px;border-radius:6px;border:1px solid rgba(0,0,0,0.12)"></textarea>
                            <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">
                                <button class="${prefix}-fd-send">${translate('send', this.language) || 'Send'}</button>
                            </div>
                        </div>
                    </div>
                </div>
                <style>
                    .${fdOverlayClass} { position: fixed; inset: 0; display:flex;align-items:center;justify-content:center;z-index:1100;background:rgba(0,0,0,0.45); }
                    .${fdContentClass} { position:relative; background: var(--ha-card-background, var(--card-background-color, #fff)); color: var(--primary-text-color); padding: 18px; border-radius:12px; width: 520px; max-width: calc(100% - 40px); max-height: calc(100vh - 40px); overflow-y: auto; }
                    .${fdContentClass} h2 { margin:0 0 8px 0; text-align:center }
                    .${prefix}-fd-close { position:absolute; left:12px; top:12px; background:none; border:none; cursor:pointer; color:var(--primary-text-color); }
                    .${prefix}-fd-reason-list { }
                    .${prefix}-fd-reason-btn {
                        cursor: pointer;
                        display: block;
                        width: 100%;
                        text-align: left;
                        padding: 10px;
                        margin: 6px 0;
                        border-radius: 8px;
                        border: none;
                        transition: background 120ms ease, transform 60ms ease;
                        background: transparent;
                    }
                    .${prefix}-fd-reason-btn:hover {
                        background: rgba(0,0,0,0.04);
                    }
                    .${prefix}-fd-reason-btn.selected {
                        background: rgba(0,0,0,0.06);
                    }
                </style>
            `;

            const overlayEl = fdWrapper.querySelector(`.${fdOverlayClass}`);
            const closeFdBtn = fdWrapper.querySelector(`.${prefix}-fd-close`);
            const page1 = fdWrapper.querySelector(`.${prefix}-fd-page-1`);
            const page2 = fdWrapper.querySelector(`.${prefix}-fd-page-2`);
            const page3 = fdWrapper.querySelector(`.${prefix}-fd-page-3`);

            const cancelBtn = fdWrapper.querySelector(`.${prefix}-fd-cancel`);
            const nextBtn = fdWrapper.querySelector(`.${prefix}-fd-next`);
            const next2Btn = fdWrapper.querySelector(`.${prefix}-fd-next-2`);
            const sendBtn = fdWrapper.querySelector(`.${prefix}-fd-send`);

            const page2Content = fdWrapper.querySelector(`.${prefix}-fd-page-2-content`);
            const finalDetails = fdWrapper.querySelector(`.${prefix}-fd-final-details`);

            const removeFd = () => {
                if (fdWrapper._escHandler) document.removeEventListener('keydown', fdWrapper._escHandler);
                if (fdWrapper.parentElement) document.body.removeChild(fdWrapper);
            };

            if (cancelBtn) cancelBtn.addEventListener('click', (ev) => { ev.stopPropagation(); removeFd(); });
            if (closeFdBtn) {
                // Close button doubles as a "back" button on page 2 and 3
                const handleCloseOrBack = (ev) => {
                    ev.stopPropagation();
                    if (!page2.hidden && page3.hidden) {
                        // on page2 -> go back to page1
                        page2.hidden = true;
                        page1.hidden = false;
                        closeFdBtn.textContent = '✕';
                        closeFdBtn.title = 'Close';
                        closeFdBtn.setAttribute('aria-label', 'Close');
                    } else if (!page3.hidden) {
                        // on page3 -> go back to page2
                        page3.hidden = true;
                        page2.hidden = false;
                        closeFdBtn.innerHTML = `
                            <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor"><path d="m313-440 196 196q12 12 11.5 28T508-188q-12 11-28 11.5T452-188L188-452q-6-6-8.5-13t-2.5-15q0-8 2.5-15t8.5-13l264-264q11-11 27.5-11t28.5 11q12 12 12 28.5T508-715L313-520h447q17 0 28.5 11.5T800-480q0 17-11.5 28.5T760-440H313Z"/></svg>
                        `;
                        closeFdBtn.title = 'Back';
                        closeFdBtn.setAttribute('aria-label', 'Back');
                    } else {
                        // default: remove dialog
                        removeFd();
                    }
                };
                closeFdBtn.addEventListener('click', handleCloseOrBack);
            }
            overlayEl.addEventListener('click', (ev) => { if (ev.target === overlayEl) removeFd(); });
            fdWrapper._escHandler = (ev) => { if (ev.key === 'Escape') removeFd(); };
            document.addEventListener('keydown', fdWrapper._escHandler);

            // Make reason buttons immediately advance to page 2
            const reasonBtns = fdWrapper.querySelectorAll(`.${prefix}-fd-reason-btn`);
            reasonBtns.forEach((btn) => {
                btn.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    // mark selected
                    reasonBtns.forEach(b => b.classList.remove('selected'));
                    btn.classList.add('selected');
                    const reason = btn.dataset.value;
                    // populate page2 based on reason
                    page2Content.innerHTML = '';
                    if (reason === 'event_not_no_activity') {
                        page2Content.innerHTML = `
                            <label style="display:block;margin:8px 0;font-weight:600">${translate('correct_title', this.language) || 'Correct title'}</label>
                            <input class="${prefix}-fd-correct-title" type="text" style="width:100%;padding:8px;border-radius:6px;border:1px solid rgba(0,0,0,0.12)">
                            <label style="display:block;margin:8px 0;font-weight:600">${translate('correct_description', this.language) || 'Correct description'}</label>
                            <textarea class="${prefix}-fd-correct-description" rows="4" style="width:100%;padding:8px;border-radius:6px;border:1px solid rgba(0,0,0,0.12)"></textarea>
                        `;
                    } else {
                        page2Content.innerHTML = `
                            <p style="margin:6px 0">${translate('confirm_selection', this.language) || 'You can add more details on the next page.'}</p>
                        `;
                    }
                    page2.dataset.reason = reason;
                    page1.hidden = true;
                    page2.hidden = false;
                    // change close button into back-arrow
                    if (closeFdBtn) {
                        closeFdBtn.innerHTML = `
                            <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor"><path d="m313-440 196 196q12 12 11.5 28T508-188q-12 11-28 11.5T452-188L188-452q-6-6-8.5-13t-2.5-15q0-8 2.5-15t8.5-13l264-264q11-11 27.5-11t28.5 11q12 12 12 28.5T508-715L313-520h447q17 0 28.5 11.5T800-480q0 17-11.5 28.5T760-440H313Z"/></svg>
                        `;
                        closeFdBtn.title = 'Back';
                        closeFdBtn.setAttribute('aria-label', 'Back');
                    }
                });
            });

            // Next button fallback (for accessibility) - use selected reason button
            if (nextBtn) {
                nextBtn.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    const selectedBtn = fdWrapper.querySelector(`.${prefix}-fd-reason-btn.selected`);
                    if (!selectedBtn) return;
                    selectedBtn.click();
                });
            }

            next2Btn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                // move to final page
                page2.hidden = true;
                page3.hidden = false;
                // ensure close button stays as back-arrow
                if (closeFdBtn) {
                    closeFdBtn.textContent = '<-';
                    closeFdBtn.title = 'Back';
                    closeFdBtn.setAttribute('aria-label', 'Back');
                }
            });

            sendBtn.addEventListener('click', async (ev) => {
                ev.stopPropagation();
                sendBtn.disabled = true;
                const reason = page2.dataset.reason || '';
                let corrections = '';
                if (reason === 'event_not_no_activity') {
                    const t = fdWrapper.querySelector(`.${prefix}-fd-correct-title`);
                    const d = fdWrapper.querySelector(`.${prefix}-fd-correct-description`);
                    const titleVal = t ? (t.value || '').trim() : '';
                    const descVal = d ? (d.value || '').trim() : '';
                    if (titleVal) corrections += `Title: ${titleVal}`;
                    if (descVal) corrections += (corrections ? '\n' : '') + `Description: ${descVal}`;
                }
                const finalText = (finalDetails.value || '').trim();
                // Include any title/description corrections from page2 (if present)
                let correctedTitle = '';
                let correctedDescription = '';
                if (reason === 'event_not_no_activity') {
                    const t = fdWrapper.querySelector(`.${prefix}-fd-correct-title`);
                    const d = fdWrapper.querySelector(`.${prefix}-fd-correct-description`);
                    correctedTitle = t ? (t.value || '').trim() : '';
                    correctedDescription = d ? (d.value || '').trim() : '';
                }
                await sendFeedback(feedback, el, reason, finalText, correctedTitle, correctedDescription);
                removeFd();
                // open snackbar to thank the user for their feedback
                showSnackbar('Thanks for your feedback!');  //TODO: translate
            });

            document.body.appendChild(fdWrapper);
        };

        const showSnackbar = (message) => {
            // close event detail popups before showing the snackbar to ensure it appears above them
            this.closePopup(wrapper, overlayClass, popstateHandler, escHandler);
            this.dispatchEvent(new CustomEvent('hass-notification', {
                bubbles: true,
                composed: true,
                detail: {
                    message,
                    duration: 4000
                }
            }));
        };

        if (thumbsUpItem && eventId) {
            thumbsUpItem.addEventListener('click', (e) => {
                e.stopPropagation();
                if (menuList) menuList.hidden = true;
                // open snackbar to thank the user for their feedback
                sendFeedback('up', thumbsUpItem, 'good_response', '', '');
                showSnackbar('Thanks for your feedback!'); //TODO: translate
            });
        }
        if (thumbsDownItem && eventId) {
            thumbsDownItem.addEventListener('click', (e) => {
                e.stopPropagation();
                if (menuList) menuList.hidden = true;
                openFeedbackDetail('down', thumbsDownItem);
            });
        }

        document.body.appendChild(wrapper);
        requestAnimationFrame(() => overlayEl.classList.add('show'));
    }

    closePopup(wrapper, overlayClass, popstateHandler, escHandler) {
        const overlay = wrapper.querySelector(`.${overlayClass}`);
        overlay.classList.remove('show');
        overlay.addEventListener('transitionend', () => {
            if (wrapper._escHandler) document.removeEventListener('keydown', wrapper._escHandler);
            document.body.removeChild(wrapper);
        }, { once: true });
        if (history.state && history.state.popupOpen) {
            history.replaceState(null, '');
        }
        window.removeEventListener('popstate', popstateHandler);
    }
}