export type ComplaintStatus = 'Submitted' | 'In Progress' | 'Resolved';
export type Role = 'student' | 'staff' | 'admin';

export type Complaint = {
  id: string;
  title: string;
  description: string;
  category: string;
  location: string;
  image?: string;
  status: ComplaintStatus;
  department: string;
  student: string;
  createdAt: string;
  updatedAt: string;
  feedback?: { rating: number; comment: string };
};

export const seedComplaints: Complaint[] = [
  { id: 'CC-1048', title: 'Wi-Fi not working in Lab 3', description: 'The connection keeps dropping during class.', category: 'IT', location: 'Computer Lab 3', status: 'In Progress', department: 'IT Department', student: 'Tasnim Turin', createdAt: '2026-11-01', updatedAt: '2026-11-01' },
  { id: 'CC-1039', title: 'Broken chair in Room 204', description: 'One of the chairs is unsafe to use.', category: 'Classroom', location: 'Room 204', status: 'Resolved', department: 'Facilities', student: 'Tasnim Turin', createdAt: '2026-10-28', updatedAt: '2026-10-30', feedback: { rating: 5, comment: 'Thank you for the quick fix.' } },
  { id: 'CC-1027', title: 'Bus arriving late on Route B', description: 'The bus has arrived late several times this week.', category: 'Transport', location: 'Main gate', status: 'Submitted', department: 'Transport', student: 'Tasnim Turin', createdAt: '2026-10-25', updatedAt: '2026-10-25' },
];

export const storeScript = `
  const KEY = 'campuscare:v1';
  const seed = ${JSON.stringify(seedComplaints)};
  function getState(){ const raw=localStorage.getItem(KEY); if(raw){ const state=JSON.parse(raw); state.users=(state.users||[]).map(u=>({...u,password:u.password||'password'})); return state; } const state={user:null,users:[{name:'Tasnim Turin',id:'R-22',email:'tasnim@example.com',role:'student',password:'password'},{name:'Prima Rahman',id:'R-23',email:'prima@example.com',role:'staff',password:'password'},{name:'Fahim Ahmed',id:'R-24',email:'fahim@example.com',role:'admin',password:'password'}],complaints:seed,notifications:[{id:1,text:'Your complaint was assigned to the IT Department.',read:false,time:'2h ago'}]}; localStorage.setItem(KEY,JSON.stringify(state)); return state; }
  function saveState(state){ localStorage.setItem(KEY,JSON.stringify(state)); return state; }
  function logout(){ const state=getState(); state.user=null; saveState(state); location.href='/login'; }
  function escapeHtml(value){ return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\\"':'&quot;',"'":'&#039;'}[c])); }
  window.CampusCare={getState,saveState,escapeHtml,logout,seed};
`;
