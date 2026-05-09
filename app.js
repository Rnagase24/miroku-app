// ── Tab navigation ──
const navBtns = document.querySelectorAll('.nav-btn');
const tabs = document.querySelectorAll('.tab-content');

navBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.tab;
    navBtns.forEach(b => b.classList.remove('active'));
    tabs.forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + target).classList.add('active');
  });
});

// ── Events data ──
const events = [
  {
    date: 'Sun, May 11',
    title: "Mother's Day Celebration",
    desc: 'A special service honoring all mothers in our congregation. Flowers provided.',
    tag: 'Special Service'
  },
  {
    date: 'Sat, May 17',
    title: 'Community Food Drive',
    desc: 'Help pack and distribute food boxes for families in need. Volunteers welcome!',
    tag: 'Community'
  },
  {
    date: 'Fri, May 23',
    title: 'Youth Game Night',
    desc: 'Fun, games, and fellowship for teens. Bring a friend! Snacks provided.',
    tag: 'Youth'
  },
  {
    date: 'Sun, Jun 1',
    title: 'Summer Kickoff Cookout',
    desc: 'Join us after the 10:30 AM service for a church-wide cookout on the lawn.',
    tag: 'Fellowship'
  },
  {
    date: 'Sat, Jun 7',
    title: "Men's Breakfast",
    desc: 'Monthly men\'s breakfast and Bible study. 8:00 AM in Fellowship Hall.',
    tag: "Men's Ministry"
  },
  {
    date: 'Sat, Jun 14',
    title: "Women's Bible Study Retreat",
    desc: 'A one-day retreat for women — worship, prayer, and fellowship.',
    tag: "Women's Ministry"
  }
];

function renderEvents() {
  const list = document.getElementById('events-list');
  list.innerHTML = events.map(e => `
    <div class="event-card">
      <div class="event-date">${e.date}</div>
      <div class="event-title">${e.title}</div>
      <div class="event-desc">${e.desc}</div>
      <span class="event-tag">${e.tag}</span>
    </div>
  `).join('');
}

// ── Directory data ──
const members = [
  { name: 'Pastor David Williams', role: 'Senior Pastor', phone: '(217) 555-0101', email: 'david@gracechurch.org' },
  { name: 'Sarah Johnson', role: 'Worship Director', phone: '(217) 555-0102', email: 'sarah@gracechurch.org' },
  { name: 'Michael Thompson', role: 'Youth Pastor', phone: '(217) 555-0103', email: 'michael@gracechurch.org' },
  { name: 'Lisa Martinez', role: 'Children\'s Ministry', phone: '(217) 555-0104', email: 'lisa@gracechurch.org' },
  { name: 'Robert Chen', role: 'Deacon', phone: '(217) 555-0105', email: 'robert@gracechurch.org' },
  { name: 'Amanda Davis', role: 'Church Administrator', phone: '(217) 555-0100', email: 'info@gracechurch.org' },
  { name: 'James Wilson', role: 'Elder', phone: '(217) 555-0106', email: 'james@gracechurch.org' },
  { name: 'Patricia Moore', role: 'Prayer Team Lead', phone: '(217) 555-0107', email: 'patricia@gracechurch.org' }
];

function initials(name) {
  return name.split(' ').slice(0, 2).map(n => n[0]).join('');
}

function renderDirectory(filter = '') {
  const list = document.getElementById('directory-list');
  const filtered = filter
    ? members.filter(m =>
        m.name.toLowerCase().includes(filter.toLowerCase()) ||
        m.role.toLowerCase().includes(filter.toLowerCase())
      )
    : members;

  list.innerHTML = filtered.length
    ? filtered.map(m => `
        <div class="member-card">
          <div class="member-avatar">${initials(m.name)}</div>
          <div>
            <div class="member-name">${m.name}</div>
            <div class="member-role">${m.role}</div>
            <div class="member-contact">
              <a href="tel:${m.phone.replace(/\D/g,'')}">${m.phone}</a>
            </div>
          </div>
        </div>
      `).join('')
    : '<p style="color:var(--text-muted);padding:16px 0;">No members found.</p>';
}

document.getElementById('directory-search').addEventListener('input', e => {
  renderDirectory(e.target.value);
});

// ── Media / Sermons data ──
const media = [
  {
    series: 'Faith That Moves Mountains',
    title: 'When God Says Wait',
    date: 'May 4, 2025',
    pastor: 'Pastor David Williams',
    icon: '&#127897;',
    url: '#'
  },
  {
    series: 'Faith That Moves Mountains',
    title: 'The Power of Persistent Prayer',
    date: 'Apr 27, 2025',
    pastor: 'Pastor David Williams',
    icon: '&#127897;',
    url: '#'
  },
  {
    series: 'Rooted',
    title: 'Finding Peace in the Storm',
    date: 'Apr 20, 2025',
    pastor: 'Michael Thompson',
    icon: '&#127897;',
    url: '#'
  },
  {
    series: 'Rooted',
    title: 'Grace Greater Than Our Sin',
    date: 'Apr 13, 2025',
    pastor: 'Pastor David Williams',
    icon: '&#127897;',
    url: '#'
  }
];

function renderMedia() {
  const list = document.getElementById('media-list');
  list.innerHTML = media.map(m => `
    <div class="media-card">
      <div class="media-thumb">${m.icon}</div>
      <div class="media-body">
        <div class="media-series">${m.series}</div>
        <div class="media-title">${m.title}</div>
        <div class="media-meta">${m.date} &bull; ${m.pastor}</div>
        <a class="media-btn" href="${m.url}">&#9654; Listen</a>
      </div>
    </div>
  `).join('');
}

// ── Init ──
renderEvents();
renderDirectory();
renderMedia();
