export const studentScript = `
  async function studentBackendReady() {
    try {
      const response = await fetch('/api/health', { credentials: 'same-origin' });
      return response.ok && Boolean((await response.json()).databaseConfigured);
    } catch {
      return false;
    }
  }
  async function studentSession() {
    const user = await CampusCare.fetchUser();
    if (!user || user.role !== 'student') {
      CampusCare.setUser(null);
      location.replace('/login');
      throw Error('Session ended');
    }
    return { user, mode: 'api' };
  }
  function studentComplaintView(c) {
    return {
      id: c.id,
      displayId: c.displayId || c.id,
      title: c.title,
      description: c.description,
      category: c.category,
      location: c.location,
      status: c.status,
      department: c.departmentId || 'Unassigned',
      createdAt: String(c.createdAt).slice(0, 10),
      updatedAt: String(c.updatedAt).slice(0, 10),
      feedback: c.feedback || null,
      imageUrl: c.imageUrl || null,
      timeline: c.timeline || []
    };
  }
  async function studentComplaints() {
    await studentSession();
    let page = 1, all = [], result;
    do {
      result = await CampusAdmin.request('/complaints?page=' + page);
      all.push(...result.items);
      page++;
    } while (all.length < result.total);
    return all.map(studentComplaintView);
  }
  async function studentComplaint(id) {
    await studentSession();
    return studentComplaintView((await CampusAdmin.request('/complaints/' + encodeURIComponent(id))).complaint);
  }
  async function studentNotifications() {
    await studentSession();
    return (await CampusAdmin.request('/notifications')).items.map(n => ({
      ...n,
      time: new Date(n.createdAt).toLocaleString()
    }));
  }
  async function studentSetRead(id, read) {
    await studentSession();
    return CampusAdmin.request('/notifications/' + encodeURIComponent(id) + '/read', 'PATCH', { read });
  }
  async function studentReadAll() {
    await studentSession();
    return CampusAdmin.request('/notifications/read-all', 'PATCH');
  }
  async function studentReport(form) {
    await studentSession();
    const response = await fetch('/api/complaints', { method: 'POST', credentials: 'same-origin', body: form });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(data.error || 'Could not submit complaint');
    return data.complaint.id;
  }
  async function studentFeedback(id, rating, comment) {
    await studentSession();
    return CampusAdmin.request('/complaints/' + encodeURIComponent(id) + '/feedback', 'POST', { rating, comment });
  }
  async function studentCategories() {
    await studentSession();
    return (await CampusAdmin.request('/categories')).items;
  }
  async function studentSaveProfile(input) {
    await studentSession();
    const data = await CampusAdmin.request('/auth/me', 'PATCH', input);
    CampusCare.setUser(data.user);
    return data.user;
  }
  window.CampusStudent = {
    backendReady: studentBackendReady,
    session: studentSession,
    complaints: studentComplaints,
    complaint: studentComplaint,
    notifications: studentNotifications,
    setRead: studentSetRead,
    readAll: studentReadAll,
    report: studentReport,
    categories: studentCategories,
    feedback: studentFeedback,
    saveProfile: studentSaveProfile
  };
`;
