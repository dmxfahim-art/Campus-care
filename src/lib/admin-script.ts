export const adminScript = `
  async function adminRequest(path, method = 'GET', body) {
    const response = await fetch('/api' + path, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(data.error || 'Request failed');
    return data;
  }
  async function adminSession() {
    const user = await CampusCare.fetchUser();
    if (!user || !['admin', 'staff'].includes(user.role)) {
      CampusCare.setUser(null);
      location.replace('/admin/login');
      throw Error('Session ended');
    }
    return { user, mode: 'api' };
  }
  function adminComplaintView(c) {
    return {
      id: c.id,
      displayId: c.displayId || c.id,
      title: c.title,
      description: c.description,
      category: c.category,
      location: c.location,
      status: c.status,
      department: c.departmentId || 'Unassigned',
      departmentId: c.departmentId || null,
      createdAt: String(c.createdAt).slice(0, 10),
      updatedAt: String(c.updatedAt).slice(0, 10),
      timeline: c.timeline || [],
      imageUrl: c.imageUrl || null
    };
  }
  async function adminComplaints(page = 1, status) {
    await adminSession();
    const query = new URLSearchParams({ page: String(page) });
    if (status && status !== 'All') query.set('status', status);
    const data = await adminRequest('/complaints?' + query);
    return { ...data, items: data.items.map(adminComplaintView) };
  }
  async function adminComplaint(id) {
    await adminSession();
    return adminComplaintView((await adminRequest('/complaints/' + encodeURIComponent(id))).complaint);
  }
  async function adminSummary() {
    await adminSession();
    return adminRequest('/dashboard/summary');
  }
  async function adminDepartments() {
    await adminSession();
    return (await adminRequest('/departments')).items;
  }
  async function adminSaveComplaint(id, department, status) {
    const state = await adminSession(), current = await adminComplaint(id);
    if (state.user.role === 'admin' && department && department !== current.departmentId) {
      await adminRequest('/complaints/' + encodeURIComponent(id) + '/assign', 'PATCH', { departmentId: department });
    }
    if (status !== current.status) {
      await adminRequest('/complaints/' + encodeURIComponent(id) + '/status', 'PATCH', { status });
    }
  }
  async function adminTeam() {
    const state = await adminSession();
    if (state.user.role !== 'admin') throw Error('Forbidden');
    return (await adminRequest('/staff')).items;
  }
  async function adminCreateTeam(input) {
    const state = await adminSession();
    if (state.user.role !== 'admin') throw Error('Forbidden');
    return adminRequest('/staff', 'POST', input);
  }
  async function adminUpdateTeam(id, input) {
    const state = await adminSession();
    if (state.user.role !== 'admin') throw Error('Forbidden');
    return adminRequest('/staff/' + encodeURIComponent(id), 'PATCH', input);
  }
  async function adminCategories() {
    return (await adminRequest('/categories')).items;
  }
  async function adminCreateCategory(input) {
    const state = await adminSession();
    if (state.user.role !== 'admin') throw Error('Forbidden');
    return adminRequest('/categories', 'POST', input);
  }
  async function adminUpdateCategory(code, input) {
    const state = await adminSession();
    if (state.user.role !== 'admin') throw Error('Forbidden');
    return adminRequest('/categories/' + encodeURIComponent(code), 'PATCH', input);
  }
  window.CampusAdmin = {
    request: adminRequest,
    session: adminSession,
    complaints: adminComplaints,
    complaint: adminComplaint,
    summary: adminSummary,
    departments: adminDepartments,
    categories: adminCategories,
    createCategory: adminCreateCategory,
    updateCategory: adminUpdateCategory,
    saveComplaint: adminSaveComplaint,
    team: adminTeam,
    createTeam: adminCreateTeam,
    updateTeam: adminUpdateTeam
  };
`;
