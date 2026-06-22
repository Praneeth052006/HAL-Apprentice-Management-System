/* ============================================================
   ApprenticeTrack Dashboard — main JS
   Handles: live clock, students list, stats, table, detail
   panel, add/delete student modal, and punch in/out.
   ============================================================ */

const COLORS = ['#6366F1','#0EA5E9','#F59E0B','#EF4444','#8B5CF6','#EC4899','#14B8A6','#F97316'];

let students = [];          // populated from API
let activeFilter = 'All', activeSearch = '', selectedId = null;
let todaysPunch = { punch_in: null, punch_out: null }; // punch record for currently selected student

/* ───────────── Sidebar user initials ───────────── */
(function () {
  const name = document.getElementById('sidebarUserName').textContent.trim();
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  document.getElementById('sidebarInitials').textContent = initials || 'U';
})();

/* ───────────── Live real-time clock (topbar) ───────────── */
function updateLiveClock() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dateStr = now.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  document.getElementById('liveClockTime').textContent = timeStr;
  document.getElementById('liveClockDate').textContent = dateStr;
}
updateLiveClock();
setInterval(updateLiveClock, 1000);

/* ───────────── Date / progress helpers ───────────── */
function parseDate(s) { return new Date(s); }
function fmtDate(s) { return parseDate(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
function daysBetween(a, b) { return Math.round((b - a) / (1000 * 60 * 60 * 24)); }
function clamp(v, mn, mx) { return Math.max(mn, Math.min(mx, v)); }
function initials(name) { return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(); }
function getToday() { return new Date(); }

function getProgress(s) {
  const start = parseDate(s.start), end = parseDate(s.end), today = getToday();
  const total = Math.max(1, daysBetween(start, end));
  const elapsed = clamp(daysBetween(start, today), 0, total);
  const pct = Math.round((elapsed / total) * 100);
  const remaining = Math.max(0, daysBetween(today, end));
  const completed = today >= end;
  return { total, elapsed, pct, remaining, completed };
}
function getAttendPct(s) { return s.totalDays > 0 ? Math.round((s.present / s.totalDays) * 100) : 0; }
function getStatus(s) {
  const prog = getProgress(s);
  if (prog.completed) return 'Completed';
  const pct = getAttendPct(s);
  if (pct >= 85) return 'Active';
  if (pct >= 70) return 'At Risk';
  return 'Critical';
}
function badgeHTML(status) {
  const map = { 'Active': 'badge-green', 'At Risk': 'badge-amber', 'Critical': 'badge-red', 'Completed': 'badge-blue' };
  return `<span class="badge ${map[status] || 'badge-blue'}">${status}</span>`;
}
function ringColor(pct) { if (pct >= 85) return 'var(--green)'; if (pct >= 70) return 'var(--amber)'; return 'var(--red)'; }
function smallRingHTML(pct, color) {
  const circ = 100.53, offset = circ * (1 - pct / 100);
  return `<svg viewBox="0 0 40 40" width="40" height="40" style="transform:rotate(-90deg)">
    <circle cx="20" cy="20" r="16" fill="none" stroke="var(--border)" stroke-width="4"/>
    <circle cx="20" cy="20" r="16" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-dasharray="${circ}" stroke-dashoffset="${offset}"/>
  </svg>`;
}
function bigRingHTML(pct, color) {
  const circ = 251.3, offset = circ * (1 - pct / 100);
  return `<svg viewBox="0 0 100 100" style="transform:rotate(-90deg);width:100px;height:100px">
    <circle cx="50" cy="50" r="40" fill="none" stroke="var(--border)" stroke-width="10"/>
    <circle cx="50" cy="50" r="40" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${circ}" stroke-dashoffset="${offset}"/>
  </svg>`;
}
function durationLabel(s) {
  const d = daysBetween(parseDate(s.start), parseDate(s.end));
  const m = Math.round(d / 30);
  return m >= 12 ? `${Math.round(m / 12)} year` : `${m} months`;
}
function fmtTime12hr(timeStr) {
  // timeStr like "14:35:02" -> "02:35 PM"
  if (!timeStr) return '—';
  const [h, m] = timeStr.split(':');
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${String(hour12).padStart(2, '0')}:${m} ${ampm}`;
}

/* ───────────── API: fetch all students ───────────── */
async function fetchStudents() {
  try {
    const res = await fetch('/api/students');
    if (res.status === 401) { window.location.href = '/login'; return; }
    students = await res.json();
    renderStats();
    renderTable();
  } catch (err) {
    document.getElementById('studentTable').innerHTML =
      `<tr class="empty-row"><td colspan="6">Could not load students. Is the server running?</td></tr>`;
  }
}

/* ───────────── Stats cards ───────────── */
function renderStats() {
  const total = students.length;
  const active = students.filter(s => getStatus(s) === 'Active').length;
  const atRisk = students.filter(s => ['At Risk', 'Critical'].includes(getStatus(s))).length;
  const completed = students.filter(s => getStatus(s) === 'Completed').length;
  const avgAtt = total ? Math.round(students.reduce((a, s) => a + getAttendPct(s), 0) / total) : 0;

  document.getElementById('statsRow').innerHTML = `
    <div class="stat-card accent-teal">
      <div class="stat-label">Total Students</div>
      <div class="stat-value" style="color:var(--teal)">${total}</div>
      <div class="stat-footer">Enrolled in apprenticeship</div>
    </div>
    <div class="stat-card accent-green">
      <div class="stat-label">Active</div>
      <div class="stat-value" style="color:var(--green)">${active}</div>
      <div class="stat-footer"><span class="up">${students.filter(s => { const p = getProgress(s); return p.remaining <= 30 && p.remaining > 0; }).length}</span> completing within 30 days</div>
    </div>
    <div class="stat-card accent-amber">
      <div class="stat-label">Avg. Attendance</div>
      <div class="stat-value" style="color:var(--amber)">${avgAtt}%</div>
      <div class="stat-footer"><span class="warn">${atRisk}</span> students below threshold</div>
    </div>
    <div class="stat-card accent-red">
      <div class="stat-label">Completed</div>
      <div class="stat-value" style="color:var(--red)">${completed}</div>
      <div class="stat-footer">Finished apprenticeship</div>
    </div>`;
}

/* ───────────── Table rendering ───────────── */
function renderTable() {
  let list = students.filter(s => {
    const matchFilter = activeFilter === 'All' || getStatus(s) === activeFilter;
    const matchSearch = s.name.toLowerCase().includes(activeSearch) || s.department.toLowerCase().includes(activeSearch);
    return matchFilter && matchSearch;
  });

  const tbody = document.getElementById('studentTable');
  if (students.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="6">No students yet. Click "Add Student" to get started.</td></tr>`;
    return;
  }
  if (list.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="6">No students found matching your criteria.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(s => {
    const prog = getProgress(s);
    const attPct = getAttendPct(s);
    const status = getStatus(s);
    const color = ringColor(attPct);
    const timelineColor = prog.completed ? 'linear-gradient(90deg,#22C55E,#4ADE80)' : 'linear-gradient(90deg,var(--teal),var(--teal2))';
    const dotColor = prog.completed ? 'var(--green)' : 'var(--teal)';
    const dotShadow = prog.completed ? '0 0 0 2px var(--green)' : '0 0 0 2px var(--teal)';
    const timelineLabel = prog.completed ? `Completed ${fmtDate(s.end)}` : `${prog.pct}% complete · ${prog.remaining} days left`;
    const isSelected = selectedId === s.id;

    return `<tr class="${isSelected ? 'selected' : ''}" id="row-${s.id}">
      <td>
        <div class="student-cell">
          <div class="avatar" style="background:${s.color}">${initials(s.name)}</div>
          <div>
            <div class="student-name">${s.name}</div>
            <div class="student-dept">${s.department}</div>
          </div>
        </div>
      </td>
      <td>
        <div style="font-weight:600;font-size:13px">${fmtDate(s.start)} – ${fmtDate(s.end)}</div>
        <div style="color:var(--text3);font-size:12px;margin-top:2px">${durationLabel(s)}</div>
      </td>
      <td>
        <div class="timeline-wrap">
          <div class="timeline-track">
            <div class="timeline-fill" style="width:${prog.pct}%;background:${timelineColor}">
              <div class="timeline-dot" style="background:${dotColor};box-shadow:${dotShadow}"></div>
            </div>
          </div>
          <div class="timeline-label">${timelineLabel}</div>
        </div>
      </td>
      <td>
        <div class="attend-wrap">
          <div class="attend-ring">${smallRingHTML(attPct, color)}</div>
          <div>
            <div class="attend-num">${attPct}%</div>
            <div class="attend-sub">${s.present}/${s.totalDays} days</div>
          </div>
        </div>
      </td>
      <td>${badgeHTML(status)}</td>
      <td>
        <button class="action-btn ${isSelected ? 'active-btn' : ''}" onclick="viewStudent(${s.id})">${isSelected ? 'Viewing' : 'View'}</button>
        <button class="action-btn delete-btn" onclick="deleteStudent(${s.id})">Delete</button>
      </td>
    </tr>`;
  }).join('');
}

/* ───────────── Detail panel: Period + Attendance + Punch card ───────────── */
async function viewStudent(id) {
  selectedId = id;
  const s = students.find(x => x.id === id);
  if (!s) return;

  renderPeriodCard(s);
  renderAttendanceCard(s);
  await loadPunchStatus(id);
  renderPunchCard(s);

  renderTable();
}

function renderPeriodCard(s) {
  const prog = getProgress(s);
  const status = getStatus(s);
  document.getElementById('detailTitle').textContent = `Student Detail View — ${s.name}`;
  document.getElementById('detailHint').textContent = 'Showing period, attendance & live punch status';

  const tagColor = status === 'Completed' ? 'background:#DCFCE7;color:#16A34A' :
    status === 'Active' ? 'background:var(--teal-bg);color:#0369A1' :
    status === 'At Risk' ? 'background:#FEF9C3;color:#D97706' : 'background:#FEE2E2;color:#DC2626';

  document.getElementById('periodCard').innerHTML = `
    <div class="detail-card-title">
      Apprenticeship Period
      <span class="tag" style="${tagColor}">${durationLabel(s)}</span>
    </div>
    <div class="tl-student">
      <div class="avatar" style="background:${s.color};width:44px;height:44px;font-size:15px">${initials(s.name)}</div>
      <div>
        <div class="tl-name">${s.name}</div>
        <div class="tl-dept">${s.department}</div>
      </div>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:600;margin-bottom:6px">
      <span style="color:var(--text2)">${fmtDate(s.start)}</span>
      <span style="color:var(--text2)">${fmtDate(s.end)}</span>
    </div>
    <div class="tl-bar-track">
      <div class="tl-bar-fill" style="width:${prog.pct}%;${prog.completed ? 'background:linear-gradient(90deg,#22C55E,#4ADE80)' : ''}"></div>
      ${!prog.completed ? `<div class="tl-bar-now" style="left:${prog.pct}%"></div>` : ''}
    </div>
    <div class="tl-row" style="margin-top:6px">
      <span>Start Date</span>
      <span style="font-weight:600;color:${prog.completed ? 'var(--green)' : 'var(--teal)'}">
        ${prog.completed ? 'Completed ✓' : `${prog.pct}% completed`}
      </span>
      <span>End Date</span>
    </div>
    <div class="tl-info-grid">
      <div class="tl-info-item">
        <div class="tl-info-label">Days Elapsed</div>
        <div class="tl-info-val">${prog.elapsed} days</div>
      </div>
      <div class="tl-info-item">
        <div class="tl-info-label">Days Remaining</div>
        <div class="tl-info-val" style="color:${prog.remaining <= 14 ? 'var(--red)' : prog.remaining <= 30 ? 'var(--amber)' : 'var(--text1)'}">
          ${prog.completed ? '—' : prog.remaining + ' days'}
        </div>
      </div>
      <div class="tl-info-item">
        <div class="tl-info-label">Total Duration</div>
        <div class="tl-info-val">${prog.total} days</div>
      </div>
      <div class="tl-info-item">
        <div class="tl-info-label">Department</div>
        <div class="tl-info-val" style="font-size:12px">${s.department}</div>
      </div>
    </div>`;
}

function renderAttendanceCard(s) {
  const attPct = getAttendPct(s);
  const color = ringColor(attPct);
  const statusTag = attPct >= 85 ? 'background:#DCFCE7;color:#16A34A' : attPct >= 70 ? 'background:#FEF9C3;color:#D97706' : 'background:#FEE2E2;color:#DC2626';
  const statusWord = attPct >= 85 ? 'Good' : attPct >= 70 ? 'At Risk' : 'Critical';

  document.getElementById('attendCard').innerHTML = `
    <div class="detail-card-title">
      Attendance Breakdown
      <span class="tag" style="${statusTag}">${attPct}% — ${statusWord}</span>
    </div>
    <div class="attend-chart-row">
      <div>
        ${bigRingHTML(attPct, color)}
        <div class="ring-label">
          <div class="ring-pct" style="color:${color}">${attPct}%</div>
          <div class="ring-sub">Attendance</div>
        </div>
      </div>
      <div style="flex:1">
        <div class="attend-stat-row">
          <span class="attend-stat-label"><span class="dot" style="background:var(--green)"></span>Present</span>
          <span class="attend-stat-val">${s.present} days</span>
        </div>
        <div class="attend-stat-row">
          <span class="attend-stat-label"><span class="dot" style="background:var(--red)"></span>Absent</span>
          <span class="attend-stat-val" style="color:var(--red)">${s.absent} days</span>
        </div>
        <div class="attend-stat-row">
          <span class="attend-stat-label"><span class="dot" style="background:var(--amber)"></span>Leave</span>
          <span class="attend-stat-val" style="color:var(--amber)">${s.leave} days</span>
        </div>
        <div class="attend-stat-row">
          <span class="attend-stat-label"><span class="dot" style="background:var(--border)"></span>Working Days</span>
          <span class="attend-stat-val">${s.totalDays} days</span>
        </div>
      </div>
    </div>`;
}

/* ───────────── Punch In / Punch Out card ───────────── */
async function loadPunchStatus(studentId) {
  try {
    const res = await fetch(`/api/students/${studentId}/punch-status`);
    if (res.ok) {
      todaysPunch = await res.json();
    } else {
      todaysPunch = { punch_in: null, punch_out: null };
    }
  } catch (err) {
    todaysPunch = { punch_in: null, punch_out: null };
  }
}

function renderPunchCard(s) {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dateStr = now.toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' });

  const punchedIn = !!todaysPunch.punch_in;
  const punchedOut = !!todaysPunch.punch_out;

  let hint = 'Punch in to start tracking today\u2019s attendance.';
  if (punchedIn && !punchedOut) hint = 'You\u2019re punched in. Don\u2019t forget to punch out at the end of the day.';
  if (punchedIn && punchedOut) hint = 'Today\u2019s attendance is complete and has been recorded as Present.';

  document.getElementById('punchCard').innerHTML = `
    <div class="detail-card-title">
      Punch In / Punch Out
      <span class="tag" style="${punchedOut ? 'background:#DCFCE7;color:#16A34A' : punchedIn ? 'background:#FEF9C3;color:#D97706' : 'background:var(--teal-bg);color:#0369A1'}">
        ${punchedOut ? 'Day Complete' : punchedIn ? 'Currently In' : 'Not Started'}
      </span>
    </div>

    <div class="punch-clock-display">
      <div class="punch-clock-time" id="punchClockTime">${timeStr}</div>
      <div class="punch-clock-date" id="punchClockDate">${dateStr}</div>
    </div>

    <div class="punch-status-row">
      <div class="punch-status-box ${punchedIn ? 'in-active' : ''}">
        <div class="punch-status-label">Punch In</div>
        <div class="punch-status-value">${fmtTime12hr(todaysPunch.punch_in)}</div>
      </div>
      <div class="punch-status-box ${punchedOut ? 'out-active' : ''}">
        <div class="punch-status-label">Punch Out</div>
        <div class="punch-status-value">${fmtTime12hr(todaysPunch.punch_out)}</div>
      </div>
    </div>

    <div class="punch-buttons">
      <button class="btn-punch btn-punch-in" id="punchInBtn" onclick="doPunchIn(${s.id})" ${punchedIn ? 'disabled' : ''}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
        Punch In
      </button>
      <button class="btn-punch btn-punch-out" id="punchOutBtn" onclick="doPunchOut(${s.id})" ${(!punchedIn || punchedOut) ? 'disabled' : ''}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        Punch Out
      </button>
    </div>

    <div class="punch-hint">${hint}</div>
  `;
}

async function doPunchIn(studentId) {
  try {
    const res = await fetch(`/api/students/${studentId}/punch-in`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) { showToast(`⚠️ ${data.error}`); return; }
    todaysPunch.punch_in = data.punch_in;
    showToast('✅ Punched in successfully!');
    const s = students.find(x => x.id === studentId);
    if (s) renderPunchCard(s);
  } catch (err) {
    showToast('Could not connect to server.');
  }
}

async function doPunchOut(studentId) {
  try {
    const res = await fetch(`/api/students/${studentId}/punch-out`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) { showToast(`⚠️ ${data.error}`); return; }
    todaysPunch.punch_out = data.punch_out;
    showToast('✅ Punched out — marked Present for today!');
    await fetchStudents();           // refresh present/total counts
    const s = students.find(x => x.id === studentId);
    if (s) {
      renderPunchCard(s);
      renderAttendanceCard(s);
      renderPeriodCard(s);
    }
  } catch (err) {
    showToast('Could not connect to server.');
  }
}

/* ───────────── Filters / Search ───────────── */
function setTab(el, filter) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  activeFilter = filter;
  renderTable();
}
function filterStudents() {
  activeSearch = document.getElementById('searchInput').value.toLowerCase();
  renderTable();
}

/* ───────────── Add Student modal ───────────── */
function openModal() {
  document.getElementById('modalError').classList.remove('show');

  const today = new Date();
  const endDate = new Date(today); endDate.setMonth(endDate.getMonth() + 6);
  document.getElementById('inp-name').value = '';
  document.getElementById('inp-dept').value = '';
  document.getElementById('inp-start').value = today.toISOString().split('T')[0];
  document.getElementById('inp-end').value = endDate.toISOString().split('T')[0];
  document.getElementById('inp-present').value = '';
  document.getElementById('inp-total').value = '';

  document.getElementById('modalOverlay').classList.add('open');
}
function closeModal() {
  document.getElementById('modalOverlay').classList.remove('open');
}
function closeModalOutside(e) {
  if (e.target === document.getElementById('modalOverlay')) closeModal();
}
function showModalError(msg) {
  const el = document.getElementById('modalError');
  el.textContent = msg;
  el.classList.add('show');
}

async function submitStudentForm() {
  const name = document.getElementById('inp-name').value.trim();
  const department = document.getElementById('inp-dept').value.trim();
  const start = document.getElementById('inp-start').value;
  const end = document.getElementById('inp-end').value;
  const present = parseInt(document.getElementById('inp-present').value) || 0;
  const totalDays = parseInt(document.getElementById('inp-total').value) || 0;

  document.getElementById('modalError').classList.remove('show');

  if (!name || !department || !start || !end) { showModalError('Please fill in all fields.'); return; }
  if (new Date(end) <= new Date(start)) { showModalError('End date must be after start date.'); return; }
  if (totalDays <= 0) { showModalError('Total working days must be greater than 0.'); return; }
  if (present > totalDays) { showModalError('Present days cannot exceed total working days.'); return; }

  const payload = { name, department, start, end, present, totalDays, color: COLORS[students.length % COLORS.length] };

  try {
    const res = await fetch('/api/students', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) { showModalError(data.error || 'Something went wrong.'); return; }

    closeModal();
    showToast(`✅ ${name} added successfully!`);
    await fetchStudents();
  } catch (err) {
    showModalError('Could not connect to server.');
  }
}

async function deleteStudent(id) {
  if (!confirm('Are you sure you want to delete this student record?')) return;
  try {
    const res = await fetch(`/api/students/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Could not delete student.'); return; }

    if (selectedId === id) {
      selectedId = null;
      document.getElementById('periodCard').innerHTML = `<div class="punch-select-prompt">Select a student to view period details</div>`;
      document.getElementById('attendCard').innerHTML = `<div class="punch-select-prompt">Select a student to view attendance details</div>`;
      document.getElementById('punchCard').innerHTML = `<div class="punch-select-prompt">Select a student to punch in / out</div>`;
      document.getElementById('detailTitle').textContent = 'Student Detail View';
      document.getElementById('detailHint').textContent = 'Click "View" on any row to load details';
    }
    showToast('🗑️ Student deleted.');
    await fetchStudents();
  } catch (err) {
    showToast('Could not connect to server.');
  }
}

/* ───────────── Toast ───────────── */
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

/* ───────────── Init ───────────── */
fetchStudents();