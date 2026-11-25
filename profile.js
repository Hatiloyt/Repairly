(() => {
  const app = window.Repairly;
  if (!app) return;

  const avatarField = document.getElementById("profile-avatar-file");
  const bannerField = document.getElementById("profile-banner-file");
  const stepImageField = document.getElementById("step-image-input");
  const notificationButton = document.getElementById("notification-button");
  const notificationCount = document.getElementById("notification-count");
  const notificationList = document.getElementById("notification-list");
  const notificationDialog = document.getElementById("notifications-dialog");
  const publicProfileDialog = document.getElementById("public-profile-dialog");
  const profileForm = document.getElementById("profile-settings-form");
  let profileDraft = { avatarData: null, bannerData: null };
  let notificationTimer = null;

  function words() { return app.words(); }
  function addText(parent, tag, className, value) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = value || "";
    parent.appendChild(element);
    return element;
  }
  function prettyDate(value) {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleString(document.documentElement.lang || "de");
  }
  function setProfilePreview() {
    const avatar = document.getElementById("profile-avatar-preview");
    const banner = document.getElementById("profile-banner-preview");
    const initials = document.getElementById("profile-avatar-initial");
    const name = document.getElementById("profile-display-name").value.trim() || app.currentUser?.name || "Repairly";
    initials.textContent = name.slice(0, 1).toUpperCase();
    avatar.style.backgroundImage = profileDraft.avatarData ? `url("${profileDraft.avatarData}")` : "none";
    avatar.classList.toggle("has-image", Boolean(profileDraft.avatarData));
    banner.style.backgroundImage = profileDraft.bannerData ? `url("${profileDraft.bannerData}")` : "none";
    banner.classList.toggle("has-image", Boolean(profileDraft.bannerData));
  }
  function openProfileSettings() {
    const user = app.currentUser;
    if (!user || !profileForm) return;
    profileForm.elements.name.value = user.name || "";
    profileForm.elements.bio.value = user.bio || "";
    avatarField.value = "";
    bannerField.value = "";
    document.getElementById("profile-clear-avatar").checked = false;
    document.getElementById("profile-clear-banner").checked = false;
    profileDraft = { avatarData: user.avatarData || null, bannerData: user.bannerData || null };
    setProfilePreview();
    void loadMySupport();
  }

  async function imageData(file, maxSize, maxBytes) {
    if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error(document.documentElement.lang.startsWith("en") ? "Choose a JPG, PNG, or WebP image." : "Bitte ein JPG-, PNG- oder WebP-Bild wählen.");
    if (file.size > 12 * 1024 * 1024) throw new Error(document.documentElement.lang.startsWith("en") ? "Image files must be under 12 MB." : "Bilddateien müssen kleiner als 12 MB sein.");
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d", { alpha: true });
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    let quality = .82;
    let blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", quality));
    while (blob && blob.size > maxBytes && quality > .38) {
      quality -= .1;
      blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", quality));
    }
    if (!blob || blob.size > maxBytes) throw new Error(document.documentElement.lang.startsWith("en") ? "Image is too large after compression." : "Das Bild ist nach dem Verkleinern noch zu groß.");
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Image could not be read."));
      reader.readAsDataURL(blob);
    });
  }

  avatarField?.addEventListener("change", async () => {
    const file = avatarField.files?.[0];
    if (!file) return;
    try {
      profileDraft.avatarData = await imageData(file, 640, 256 * 1024);
      document.getElementById("profile-clear-avatar").checked = false;
      setProfilePreview();
    } catch (error) { app.showToast(error.message, "error"); avatarField.value = ""; }
  });
  bannerField?.addEventListener("change", async () => {
    const file = bannerField.files?.[0];
    if (!file) return;
    try {
      profileDraft.bannerData = await imageData(file, 1600, 512 * 1024);
      document.getElementById("profile-clear-banner").checked = false;
      setProfilePreview();
    } catch (error) { app.showToast(error.message, "error"); bannerField.value = ""; }
  });
  document.getElementById("profile-clear-avatar")?.addEventListener("change", (event) => { if (event.currentTarget.checked) { profileDraft.avatarData = null; avatarField.value = ""; setProfilePreview(); } });
  document.getElementById("profile-clear-banner")?.addEventListener("change", (event) => { if (event.currentTarget.checked) { profileDraft.bannerData = null; bannerField.value = ""; setProfilePreview(); } });
  document.getElementById("profile-display-name")?.addEventListener("input", setProfilePreview);

  profileForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("[type=submit]");
    const message = form.querySelector(".form-message");
    button.disabled = true;
    message.textContent = "";
    try {
      const result = await app.api("/api/profile", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.elements.name.value, bio: form.elements.bio.value, avatarData: profileDraft.avatarData, bannerData: profileDraft.bannerData })
      });
      app.setCurrentUser(result.user);
      message.textContent = words().profileSaved;
      message.className = "form-message is-success";
      setProfilePreview();
      await app.refreshRepairs();
    } catch (error) {
      message.textContent = error.message || words().profileSaveFailed;
      message.className = "form-message is-error";
    } finally { button.disabled = false; }
  });

  stepImageField?.addEventListener("change", async () => {
    const files = Array.from(stepImageField.files || []);
    const preview = document.getElementById("step-image-preview");
    preview.replaceChildren();
    if (files.length > 8) {
      stepImageField.value = "";
      app.pendingStepImages = [];
      app.showToast(words().stepImageLimit, "error");
      return;
    }
    const stepCount = document.querySelector('#repair-form [name="steps"]').value.split(/\r?\n/).map((step) => step.trim()).filter(Boolean).length;
    if (files.length > stepCount) {
      stepImageField.value = "";
      app.pendingStepImages = [];
      app.showToast(words().stepImagesForSteps, "error");
      return;
    }
    try {
      app.pendingStepImages = await Promise.all(files.map((file) => imageData(file, 1280, 180 * 1024)));
      app.pendingStepImages.forEach((src, index) => {
        const item = document.createElement("div"); item.className = "step-image-thumb";
        const image = document.createElement("img"); image.src = src; image.alt = (document.documentElement.lang.startsWith("en") ? "Step " : "Schritt ") + String(index + 1);
        addText(item, "span", "", `${document.documentElement.lang.startsWith("en") ? "Step" : "Schritt"} ${index + 1}`);
        item.prepend(image); preview.appendChild(item);
      });
    } catch (error) {
      stepImageField.value = ""; app.pendingStepImages = [];
      app.showToast(error.message, "error");
    }
  });

  function avatarElement(user, className = "profile-avatar-small") {
    const avatar = document.createElement("span"); avatar.className = className;
    if (user?.avatarData) {
      const image = document.createElement("img"); image.src = user.avatarData; image.alt = ""; image.loading = "lazy"; avatar.appendChild(image);
    } else avatar.textContent = (user?.name || "R").slice(0, 1).toUpperCase();
    return avatar;
  }

  async function openPublicProfile(userId) {
    if (!userId || !publicProfileDialog) return;
    document.getElementById("public-profile-title").textContent = "…";
    document.getElementById("public-profile-bio").textContent = "";
    document.getElementById("public-profile-repairs").replaceChildren();
    publicProfileDialog.showModal();
    try {
      const result = await app.api("/api/users/" + encodeURIComponent(userId));
      const profile = result.profile;
      const banner = document.getElementById("public-profile-banner");
      banner.style.backgroundImage = profile.bannerData ? `url("${profile.bannerData}")` : "none";
      banner.classList.toggle("has-image", Boolean(profile.bannerData));
      const avatar = document.getElementById("public-profile-avatar"); avatar.replaceChildren(avatarElement(profile, "public-profile-avatar-image"));
      document.getElementById("public-profile-title").textContent = profile.name;
      document.getElementById("public-profile-bio").textContent = profile.bio || "";
      const guides = document.getElementById("public-profile-repairs");
      const guideCount = result.repairs.length;
      document.getElementById("public-profile-guide-count").textContent = String(guideCount);
      if (!guideCount) addText(guides, "p", "profile-empty", words().noProfileGuides);
      result.repairs.forEach((repair) => {
        const card = document.createElement("article"); card.className = "profile-guide-card";
        addText(card, "p", "profile-guide-meta", repair.vehicle);
        addText(card, "h4", "", repair.title);
        addText(card, "p", "profile-guide-summary", repair.summary);
        const footer = document.createElement("div"); footer.className = "profile-guide-footer";
        addText(footer, "span", "", `${repair.likes || 0} ${words().likes}`);
        addText(footer, "span", "", `${repair.confirmations || 0} ${words().confirmations}`);
        card.appendChild(footer);
        if (repair.stepImages?.some(Boolean)) {
          const thumbList = document.createElement("div"); thumbList.className = "profile-guide-images";
          repair.stepImages.filter(Boolean).slice(0, 4).forEach((src) => { const image = document.createElement("img"); image.src = src; image.alt = ""; image.loading = "lazy"; thumbList.appendChild(image); });
          card.appendChild(thumbList);
        }
        guides.appendChild(card);
      });
    } catch {
      document.getElementById("public-profile-title").textContent = document.documentElement.lang.startsWith("en") ? "Profile unavailable" : "Profil nicht verfügbar";
      document.getElementById("public-profile-bio").textContent = "";
    }
  }

  document.addEventListener("click", (event) => {
    const profileButton = event.target.closest("[data-user-profile]");
    if (profileButton) void openPublicProfile(profileButton.dataset.userProfile);
  });
  document.addEventListener("repairly:openprofile", (event) => void openPublicProfile(event.detail?.userId));

  function supportStatusText(report) { return report.status === "open" ? words().supportStatusOpen : words().supportStatusClosed; }
  function renderMessages(parent, report, includeDescription = true) {
    const list = document.createElement("div"); list.className = "support-message-list";
    if (includeDescription) {
      const initial = document.createElement("article"); initial.className = "support-message is-user";
      addText(initial, "strong", "", report.userName || words().supportFromYou);
      addText(initial, "p", "", report.description || "");
      addText(initial, "time", "", prettyDate(report.createdAt));
      list.appendChild(initial);
    }
    (report.messages || []).forEach((message) => {
      const item = document.createElement("article"); item.className = "support-message" + (message.authorRole === "team" ? " is-team" : " is-user");
      addText(item, "strong", "", message.authorName || (message.authorRole === "team" ? words().supportFromTeam : words().supportFromYou));
      addText(item, "p", "", message.text);
      addText(item, "time", "", prettyDate(message.createdAt));
      list.appendChild(item);
    });
    parent.appendChild(list);
  }

  async function loadMySupport() {
    const container = document.getElementById("profile-support-list");
    if (!container || !app.currentUser) return;
    container.replaceChildren();
    try {
      const result = await app.api("/api/support/mine");
      if (!result.reports.length) { addText(container, "p", "profile-empty", words().noMySupport); return; }
      result.reports.forEach((report) => {
        const card = document.createElement("article"); card.className = "profile-support-card";
        const head = document.createElement("div"); head.className = "profile-support-head";
        addText(head, "h4", "", report.title); addText(head, "span", "report-state" + (report.status === "open" ? " is-open" : ""), supportStatusText(report));
        card.appendChild(head);
        renderMessages(card, report);
        const form = document.createElement("form"); form.className = "support-reply-form";
        const field = document.createElement("textarea"); field.name = "text"; field.rows = 2; field.maxLength = 2000; field.required = true; field.placeholder = words().supportReplyPlaceholder;
        const send = document.createElement("button"); send.type = "submit"; send.className = "comment-submit"; send.textContent = words().supportReplySend;
        form.append(field, send);
        form.addEventListener("submit", async (event) => {
          event.preventDefault(); send.disabled = true;
          try {
            await app.api(`/api/support/${encodeURIComponent(report.id)}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: field.value, deviceToken: app.supportDeviceToken() }) });
            app.showToast(words().supportReplySaved, "success");
            await loadMySupport();
          } catch (error) { app.showToast(error.message || words().supportUnavailable, "error"); send.disabled = false; }
        });
        card.appendChild(form); container.appendChild(card);
      });
    } catch { addText(container, "p", "profile-empty", words().supportUnavailable); }
  }

  function renderAdminThread(container, report) {
    const heading = document.createElement("div"); heading.className = "admin-thread-heading";
    addText(heading, "strong", "", document.documentElement.lang.startsWith("en") ? "Ticket conversation" : "Ticket-Verlauf");
    if (report.discordThreadId && report.discordGuildId) {
      const link = document.createElement("a"); link.href = `https://discord.com/channels/${encodeURIComponent(report.discordGuildId)}/${encodeURIComponent(report.discordThreadId)}`; link.target = "_blank"; link.rel = "noopener noreferrer";
      link.textContent = "Discord ↗"; link.className = "discord-ticket-link"; heading.appendChild(link);
    }
    container.appendChild(heading);
    if (report.discordSyncState === "pending") addText(container, "p", "discord-ticket-note", words().discordTicketPending);
    else if (report.discordSyncState === "failed") addText(container, "p", "discord-ticket-note is-error", report.discordSyncError || words().discordTicketFailed);
    renderMessages(container, report);
    const form = document.createElement("form"); form.className = "support-reply-form admin-support-reply-form";
    const field = document.createElement("textarea"); field.name = "text"; field.rows = 2; field.maxLength = 2000; field.required = true; field.placeholder = words().supportReplyPlaceholder;
    const send = document.createElement("button"); send.type = "submit"; send.className = "comment-submit"; send.textContent = words().supportReplySend;
    form.append(field, send);
    form.addEventListener("submit", async (event) => {
      event.preventDefault(); send.disabled = true;
      try {
        await app.api(`/api/admin/reports/${encodeURIComponent(report.id)}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: field.value }) });
        app.showToast(words().supportReplySaved, "success");
        await app.refreshAdmin();
      } catch (error) { app.showToast(error.message || words().supportUnavailable, "error"); send.disabled = false; }
    });
    container.appendChild(form);
  }
  window.RepairlyEnhancements = { renderAdminThread };

  function notificationText(item) {
    if (item.type === "like") return item.actorName + " " + words().notificationLiked;
    if (item.type === "comment") return item.actorName + " " + words().notificationCommented;
    if (item.type === "support_closed") return item.actorName + " " + words().notificationSupportClosed;
    return item.actorName + " " + words().notificationSupportReply;
  }
  async function refreshNotifications() {
    if (!app.currentUser || !notificationList) {
      if (notificationCount) notificationCount.hidden = true;
      return;
    }
    try {
      const result = await app.api("/api/notifications");
      notificationCount.textContent = String(result.unreadCount || 0);
      notificationCount.hidden = !(result.unreadCount > 0);
      if (!notificationDialog.open) return;
      notificationList.replaceChildren();
      if (!result.notifications.length) addText(notificationList, "p", "profile-empty", words().noNotifications);
      result.notifications.forEach((item) => {
        const row = document.createElement("button"); row.type = "button"; row.className = "notification-row" + (!item.readAt ? " is-unread" : "");
        row.dataset.notificationId = item.id; row.dataset.repairId = item.repairId || ""; row.dataset.reportId = item.reportId || "";
        row.appendChild(avatarElement({ name: item.actorName, avatarData: null }));
        const copy = document.createElement("span"); copy.className = "notification-copy";
        addText(copy, "strong", "", notificationText(item)); addText(copy, "time", "", prettyDate(item.createdAt));
        row.appendChild(copy); notificationList.appendChild(row);
      });
    } catch { if (notificationDialog.open) addText(notificationList, "p", "profile-empty", words().notificationsLoadError); }
  }

  notificationButton?.addEventListener("click", async () => {
    await refreshNotifications();
    notificationDialog.showModal();
    await refreshNotifications();
  });
  document.getElementById("notifications-read-all")?.addEventListener("click", async () => {
    try { await app.api("/api/notifications/read-all", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); await refreshNotifications(); }
    catch (error) { app.showToast(error.message || words().notificationsLoadError, "error"); }
  });
  notificationList?.addEventListener("click", async (event) => {
    const row = event.target.closest("[data-notification-id]");
    if (!row) return;
    try { await app.api(`/api/notifications/${encodeURIComponent(row.dataset.notificationId)}/read`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); }
    catch {}
    notificationDialog.close();
    if (row.dataset.repairId) {
      const card = document.getElementById("repair-" + row.dataset.repairId);
      if (card) { card.scrollIntoView({ behavior: "smooth", block: "center" }); card.classList.add("notification-highlight"); window.setTimeout(() => card.classList.remove("notification-highlight"), 1400); }
    } else if (row.dataset.reportId) {
      if (!document.getElementById("profile-dialog").open) document.querySelector("[data-open-profile]")?.click();
    }
    void refreshNotifications();
  });

  document.getElementById("profile-support-refresh")?.addEventListener("click", () => void loadMySupport());
  document.addEventListener("repairly:profileopen", openProfileSettings);
  document.addEventListener("repairly:sessionchange", () => {
    void refreshNotifications();
    if (notificationTimer) window.clearInterval(notificationTimer);
    notificationTimer = app.currentUser ? window.setInterval(refreshNotifications, 30_000) : null;
    if (app.currentUser && document.getElementById("profile-dialog").open) openProfileSettings();
  });
  document.addEventListener("repairly:languagechange", () => {
    setProfilePreview();
    void refreshNotifications();
    if (document.getElementById("profile-dialog").open) void loadMySupport();
  });

  if (app.currentUser) {
    void refreshNotifications();
    notificationTimer = window.setInterval(refreshNotifications, 30_000);
  }
})();
