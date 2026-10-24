const savedAuthorization = localStorage.getItem('myyaan_authorization');
const legacyToken = localStorage.getItem('myyaan_token');
const state = { authorization: savedAuthorization || (legacyToken ? `Bearer ${legacyToken}` : null), adminName: localStorage.getItem('myyaan_admin_name') || 'Admin', page: 'overview', data: {} };
const $ = s => document.querySelector(s);
const content = $('#content');
const greeting = () => { const h = new Date().getHours(); return `Good ${h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'}, ${state.adminName.split(' ')[0]}`; };
const titleMap = { overview:['DASHBOARD',null],orders:['OPERATIONS','Bookings'],customers:['CRM','Customers'],vendors:['NETWORK','Service partners'],payments:['FINANCE','Payments'],coupons:['PROMOTIONS','Coupons'],services:['CATALOG','Services & pricing'],settings:['SYSTEM','Settings'] };
const money = n => new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(Number(n || 0));
const date = d => d ? new Date(d).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) : '—';
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const status = v => `<span class="status ${escapeHtml(String(v || '').toLowerCase().replaceAll(' ','_'))}">${escapeHtml(String(v || 'pending').replaceAll('_',' ').toLowerCase())}</span>`;
// MyYaan API responses wrap their payload in { success, data }.
const unwrap = response => response?.data ?? response ?? {};

async function api(path, options = {}) {
  const r = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', Authorization: state.authorization, ...options.headers } });
  if (r.status === 401) { logout(); throw new Error('Your session has expired. Please sign in again.'); }
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.message || 'Request failed');
  return body;
}
function toast(text){const el=$('#toast');el.textContent=text;el.classList.remove('hidden');setTimeout(()=>el.classList.add('hidden'),2800)}
function setPage(page){state.page=page;document.querySelectorAll('#nav button[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===page));const [crumb,title]=titleMap[page];$('#pageCrumb').textContent=crumb;$('#pageTitle').textContent=title||greeting();$('.sidebar').classList.remove('open');render();}
function table(headers, rows, {search=true}={}){return `<div class="panel table-panel">${search?'<div class="toolbar"><input id="search" placeholder="Search records…" /></div>':''}<table class="data-table"><thead><tr>${headers.map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${headers.length}" class="empty">No records yet.</td></tr>`}</tbody></table></div>`}
function metric(label, value, note){return `<div class="metric"><div class="label">${label}</div><div class="value">${value}</div><div class="delta">${note}</div></div>`}
async function render(){ const page=state.page; content.innerHTML='<div class="empty">Loading…</div>'; try { if(page==='overview') await overview(); else if(page==='orders') await bookingsPage('orders'); else if(page==='customers') await customers(); else if(page==='vendors') await vendors(); else if(page==='payments') await bookingsPage('payments'); else if(page==='coupons') await coupons(); else if(page==='services') services(); else await settings(); } catch(e){ if(state.authorization&&state.page===page) content.innerHTML=`<div class="panel empty">${escapeHtml(e.message)}<br><small>Check your connection and try again.</small></div>`; }}

// Fetch every booking (the API pages results) for views that aggregate them.
async function allBookings(){
  const rows=[];
  for(let page=1;page<=20;page++){
    const d=unwrap(await api(`/api/admin/bookings?page=${page}&limit=200`));
    rows.push(...(d.bookings||[]));
    if(page>=(d.pagination?.totalPages||1)) break;
  }
  return rows;
}

async function overview(){
  const [bookingStats,couponStats,partners,bookings]=await Promise.all([
    api('/api/admin/bookings/stats/summary').then(unwrap),
    api('/api/admin/coupons/stats/summary').then(unwrap).catch(()=>({})),
    api('/api/admin/service-partners?limit=1').then(unwrap).catch(()=>({})),
    allBookings()
  ]);
  // Booking value per day for the last 7 days, by the day the booking was made.
  const days=[...Array(7)].map((_,i)=>{const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-6+i);return d});
  const series=days.map(d=>({day:d.toLocaleDateString('en-IN',{weekday:'short'}),value:bookings.filter(b=>b.booking_status!=='CANCELLED'&&new Date(b.created_at).toDateString()===d.toDateString()).reduce((a,b)=>a+Number(b.final_amount||0),0)}));
  const max=Math.max(1,...series.map(x=>x.value));
  const recent=bookings.slice(0,5);
  content.innerHTML=`<div class="overview-grid"><section class="metrics">
    ${metric('TOTAL BOOKINGS',escapeHtml(bookingStats.total_bookings??0),`↗ ${escapeHtml(bookingStats.completed_bookings??0)} completed`)}
    ${metric('UPCOMING',escapeHtml(bookingStats.upcoming_bookings??0),`${escapeHtml(bookingStats.cancelled_bookings??0)} cancelled`)}
    ${metric('REVENUE COLLECTED',money(bookingStats.total_collected_revenue),`${money(bookingStats.total_pending_amount)} pending`)}
    ${metric('SERVICE PARTNERS',escapeHtml(partners.pagination?.total??'—'),`${escapeHtml(couponStats.active_coupons??0)} active coupons`)}
  </section><section class="panel"><div class="panel-title"><h2>Bookings this week</h2><button>Last 7 days</button></div><div class="chart">${series.map((x,i)=>`<div class="bar-group" title="${money(x.value)}"><i class="bar ${i===series.length-1?'active':''}" style="height:${Math.max(8,x.value/max*100)}%"></i><small>${x.day}</small></div>`).join('')}</div><div class="chart-note">BOOKING VALUE <b>${money(series.reduce((a,x)=>a+x.value,0))}</b></div></section><section class="panel"><div class="panel-title"><h2>Latest bookings</h2><button onclick="setPage('orders')">View all</button></div><div class="queue">${recent.length?recent.map(b=>`<div class="queue-item"><div class="queue-icon">⚒</div><div><b>${escapeHtml(b.customer_name||'Customer')}</b><small>${escapeHtml([b.vehicle_company_name,b.vehicle_model_name].filter(Boolean).join(' ')||b.vehicle_type||'Vehicle')} · ${escapeHtml(b.service_name||'Service')}</small></div>${status(b.booking_status)}</div>`).join(''):'<div class="empty">No bookings yet.</div>'}</div></section></div>`;
}

// Bookings and Payments both read /api/admin/bookings, with different columns and filters.
const bookingViews = {
  orders: {
    eyebrow:'JOB TRACKER', title:'Bookings', intro:'Every booking made through the MyYaan app.',
    filter:'booking_status', filterLabel:'All booking statuses', options:['PENDING','CONFIRMED','COMPLETED','CANCELLED'],
    headers:['BOOKING','CUSTOMER','SERVICE','PARTNER','SLOT','AMOUNT','PAYMENT','STATUS',''],
    row:b=>`<td><b>${escapeHtml(b.booking_number)}</b><small>${date(b.created_at)}</small></td><td><b>${escapeHtml(b.customer_name||'—')}</b><small>${escapeHtml(b.customer_mobile||'')}</small></td><td>${escapeHtml(b.service_name||'—')}<small>${escapeHtml([b.sub_service_name,b.service_option_name].filter(Boolean).join(' · '))}<br>${escapeHtml([b.vehicle_company_name,b.vehicle_model_name,b.vehicle_number].filter(Boolean).join(' · '))}</small></td><td>${escapeHtml(b.service_center_name||'—')}<small>${escapeHtml(b.service_center_city||'')}</small></td><td>${date(b.booking_date)}<small>${escapeHtml(b.booking_time_slot||'')}</small></td><td>${money(b.final_amount)}</td><td>${status(b.payment_status)}</td><td>${status(b.booking_status)}</td><td><button class="outline booking-details" data-id="${escapeHtml(b.booking_id)}">View</button></td>`
  },
  payments: {
    eyebrow:'MONEY IN', title:'Payments', intro:'Collections and dues across all bookings.',
    filter:'payment_status', filterLabel:'All payment statuses', options:['PENDING','PAID','PARTIALLY_PAID','CASH_COLLECTED'],
    headers:['BOOKING','CUSTOMER','PARTNER','MODE','AMOUNT','PAID','DUE','PAYMENT','BOOKED ON'],
    row:b=>`<td><b>${escapeHtml(b.booking_number)}</b><small>${status(b.booking_status)}</small></td><td><b>${escapeHtml(b.customer_name||'—')}</b><small>${escapeHtml(b.customer_mobile||'')}</small></td><td>${escapeHtml(b.service_center_name||'—')}</td><td>${escapeHtml(String(b.payment_mode||'—').replaceAll('_',' '))}</td><td>${money(b.final_amount)}</td><td>${money(b.paid_amount)}</td><td>${money(b.due_amount)}</td><td>${status(b.payment_status)}</td><td>${date(b.created_at)}</td>`
  }
};
async function bookingsPage(kind, page=1){
  const view=bookingViews[kind];
  const filters=state.data[`${kind}Filters`]||{};
  const query=new URLSearchParams({page:String(page),limit:'15'});
  for(const [key,value] of Object.entries(filters)) if(value) query.set(key,value);
  const [list,stats]=await Promise.all([api(`/api/admin/bookings?${query}`).then(unwrap),kind==='payments'?api('/api/admin/bookings/stats/summary').then(unwrap):null]);
  if(state.page!==kind) return;
  const rows=list.bookings||[];
  const pagination=list.pagination||{};
  const summary=stats?`<section class="metrics" style="margin-bottom:18px">${metric('COLLECTED',money(stats.total_collected_revenue),`${escapeHtml(stats.paid_bookings??0)} paid bookings`)}${metric('PENDING',money(stats.total_pending_amount),`${escapeHtml(stats.pending_payment_bookings??0)} awaiting payment`)}${metric('TOTAL BOOKING VALUE',money(stats.total_booking_value),`${escapeHtml(stats.total_bookings??0)} bookings`)}</section>`:'';
  content.innerHTML=`<div class="page-top"><div><p class="eyebrow">${view.eyebrow}</p><h2>${view.title}</h2><p>${view.intro}</p></div></div>${summary}<section class="panel table-panel"><div class="toolbar"><input id="bookingSearch" value="${escapeHtml(filters.search||'')}" placeholder="Search booking number, customer or mobile" /><select id="bookingFilter"><option value="">${view.filterLabel}</option>${view.options.map(o=>`<option value="${o}" ${filters[view.filter]===o?'selected':''}>${o.replaceAll('_',' ').toLowerCase()}</option>`).join('')}</select></div><table class="data-table"><thead><tr>${view.headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.map(b=>`<tr>${view.row(b)}</tr>`).join(''):`<tr><td colspan="${view.headers.length}" class="empty">No bookings found.</td></tr>`}</tbody></table>${pager(pagination,page,rows.length,'booking')}</section>`;
  const load=()=>{state.data[`${kind}Filters`]={search:$('#bookingSearch').value.trim(),[view.filter]:$('#bookingFilter').value};bookingsPage(kind,1).catch(e=>toast(e.message))};
  $('#bookingSearch').onchange=load;$('#bookingFilter').onchange=load;
  $('#pagePrevious').onclick=()=>bookingsPage(kind,page-1).catch(e=>toast(e.message));$('#pageNext').onclick=()=>bookingsPage(kind,page+1).catch(e=>toast(e.message));
  document.querySelectorAll('.booking-details').forEach(button=>button.onclick=()=>recordDetails(`/api/admin/bookings/${encodeURIComponent(button.dataset.id)}`,'Booking'));
}
function pager(pagination,page,count,noun){const total=pagination.total??count;return `<div class="toolbar" style="margin-top:18px"><small>${escapeHtml(total)} ${noun}${total==1?'':'s'} · Page ${escapeHtml(pagination.page||page)} of ${escapeHtml(pagination.totalPages||1)}</small><div><button class="outline" id="pagePrevious" ${page<=1?'disabled':''}>Previous</button> <button class="outline" id="pageNext" ${(pagination.totalPages||1)<=page?'disabled':''}>Next</button></div></div>`}

// Shows every simple field of a record returned by a detail endpoint.
async function recordDetails(path,title){
  modal('<div class="empty">Loading details…</div>');
  try{
    const record=unwrap(await api(path));
    const label=k=>k.replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
    const value=(k,v)=>/(_at|_date)$/.test(k)&&v?date(v):/amount|price|value$/.test(k)&&v!==null&&!isNaN(v)?money(v):typeof v==='boolean'?(v?'Yes':'No'):escapeHtml(v);
    const fields=Object.entries(record).filter(([,v])=>v!==null&&v!==''&&typeof v!=='object');
    modal(`<h2>${escapeHtml(title)} ${escapeHtml(record.booking_number||record.code||'')}</h2><div class="form-grid">${fields.map(([k,v])=>`<div><b>${escapeHtml(label(k))}</b><p>${value(k,v)}</p></div>`).join('')}</div>`);
  }catch(error){modal(`<h2>Unable to load details</h2><p>${escapeHtml(error.message)}</p>`)}
}

// The API has no customer list, so build it from the customers who have booked.
async function customers(){
  const bookings=await allBookings();
  if(state.page!=='customers') return;
  const byCustomer=new Map();
  for(const b of bookings){
    const key=b.customer_id??b.customer_mobile;
    const c=byCustomer.get(key)||{name:b.customer_name,mobile:b.customer_mobile,vehicles:new Set(),bookings:0,spent:0,last:null};
    c.bookings++;
    if(b.booking_status!=='CANCELLED') c.spent+=Number(b.final_amount||0);
    const vehicle=[b.vehicle_company_name,b.vehicle_model_name].filter(Boolean).join(' ');
    if(vehicle) c.vehicles.add(b.vehicle_number?`${vehicle} · ${b.vehicle_number}`:vehicle);
    if(!c.last||new Date(b.created_at)>new Date(c.last)) c.last=b.created_at;
    byCustomer.set(key,c);
  }
  const rows=[...byCustomer.values()].sort((a,b)=>new Date(b.last)-new Date(a.last));
  content.innerHTML=`<div class="page-top"><div><p class="eyebrow">CUSTOMER DIRECTORY</p><h2>Customers</h2><p>${rows.length} customer${rows.length===1?'':'s'} who have booked through the MyYaan app.</p></div></div>${table(['CUSTOMER','MOBILE','VEHICLES','BOOKINGS','BOOKING VALUE','LAST BOOKING'],rows.map(c=>`<tr><td><b>${escapeHtml(c.name||'—')}</b></td><td>${escapeHtml(c.mobile||'—')}</td><td>${[...c.vehicles].map(escapeHtml).join('<br>')||'—'}</td><td>${c.bookings}</td><td>${money(c.spent)}</td><td>${date(c.last)}</td></tr>`).join(''))}`;
  bindSearch();
}

async function vendors(page=1){const filters=state.data.partnerFilters||{};const query=new URLSearchParams({page:String(page),limit:'10'});for(const [key,value] of Object.entries(filters))if(value&&value!=='all')query.set(key,value);const response=unwrap(await api(`/api/admin/service-partners?${query}`));if(state.page!=='vendors')return;const rows=response.partners||[];const pagination=response.pagination||{};content.innerHTML=`<div class="page-top"><div><p class="eyebrow">PARTNER NETWORK</p><h2>Service partners</h2><p>Live data from the MyYaan service-partner API.</p></div></div><section class="panel table-panel"><div class="toolbar"><input id="partnerSearch" value="${escapeHtml(filters.search||'')}" placeholder="Search name, owner, mobile, city or pincode" /><select id="partnerStatus"><option value="all">All statuses</option><option value="true" ${filters.is_active==='true'?'selected':''}>Active</option><option value="false" ${filters.is_active==='false'?'selected':''}>Inactive</option></select><select id="partnerOnboarding"><option value="">All onboarding</option><option value="completed" ${filters.onboarding_status==='completed'?'selected':''}>Completed</option><option value="pending" ${filters.onboarding_status==='pending'?'selected':''}>Pending</option></select></div><table class="data-table"><thead><tr><th>PARTNER</th><th>OWNER</th><th>LOCATION</th><th>ONBOARDING</th><th>BOOKINGS</th><th>STATUS</th><th></th></tr></thead><tbody>${rows.length?rows.map(x=>`<tr><td><b>${escapeHtml(x.service_center_name)}</b><small>${escapeHtml(x.owner_email||'')}</small></td><td><b>${escapeHtml(x.owner_name||'—')}</b><small>${escapeHtml(x.owner_mobile||'')}</small></td><td>${escapeHtml([x.city,x.state].filter(Boolean).join(', ')||'—')}<small>${escapeHtml(x.pincode||'')}</small></td><td>${status(x.onboarding_status||'pending')}</td><td>${escapeHtml(x.total_bookings_count||'0')}</td><td>${status(x.is_active?'active':'inactive')}</td><td><button class="outline partner-details" data-partner-id="${escapeHtml(x.service_center_id)}">View details</button></td></tr>`).join(''):'<tr><td colspan="7" class="empty">No service partners found.</td></tr>'}</tbody></table>${pager(pagination,page,rows.length,'partner')}</section>`;const load=()=>{state.data.partnerFilters={search:$('#partnerSearch').value.trim(),is_active:$('#partnerStatus').value,onboarding_status:$('#partnerOnboarding').value};vendors(1).catch(e=>toast(e.message))};$('#partnerSearch').onchange=load;$('#partnerStatus').onchange=load;$('#partnerOnboarding').onchange=load;$('#pagePrevious').onclick=()=>vendors(page-1).catch(e=>toast(e.message));$('#pageNext').onclick=()=>vendors(page+1).catch(e=>toast(e.message));document.querySelectorAll('.partner-details').forEach(button=>button.onclick=()=>partnerDetails(button.dataset.partnerId));}
async function partnerDetails(id){modal('<div class="empty">Loading service partner details…</div>');try{const p=unwrap(await api(`/api/admin/service-partners/${encodeURIComponent(id)}`));const bank=p.bank_details||{};const timings=p.timing_slots||{};const stats=p.order_stats||{};const vehicles=(p.supported_vehicles||[]).map(v=>`${v.vehicle_category}: ${v.service_name}`).join(', ')||'—';modal(`${p.service_center_pic_url?`<img src="${escapeHtml(p.service_center_pic_url)}" alt="${escapeHtml(p.service_center_name)}" style="width:72px;height:72px;border-radius:12px;object-fit:cover">`:''}<h2>${escapeHtml(p.service_center_name)}</h2><p>${escapeHtml([p.address_line_1,p.address_line_2,p.city,p.state,p.pincode].filter(Boolean).join(', '))}${p.latitude&&p.longitude?`<br><small>${escapeHtml(p.latitude)}, ${escapeHtml(p.longitude)}</small>`:''}</p><div class="form-grid"><div><b>Owner</b><p>${escapeHtml(p.owner_name||'—')}<br>${escapeHtml(p.owner_mobile||'')}<br>${escapeHtml(p.owner_email||'')}</p></div><div><b>Status</b><p>${status(p.is_active?'active':'inactive')} ${status(p.onboarding_summary?.status||'pending')}</p></div><div><b>Opening hours</b><p>${timings.is_open_24x7?'Open 24×7':`${escapeHtml(timings.opening_time||'—')} – ${escapeHtml(timings.closing_time||'—')}`}<br><small>${escapeHtml((timings.open_days||[]).join(', '))}</small></p></div><div><b>Capacity</b><p>Walk-in: ${escapeHtml(timings.default_walk_in_capacity||'0')} · Pick & drop: ${escapeHtml(timings.default_pick_n_drop_capacity||'0')}<br><small>Home service: ${escapeHtml(timings.default_home_service_capacity||'0')} · ${escapeHtml(timings.slot_duration_hours||'—')} hour slots</small></p></div><div><b>Supported vehicles</b><p>${escapeHtml(vehicles)}</p></div><div><b>Order summary</b><p>${escapeHtml(stats.total_orders||'0')} total · ${escapeHtml(stats.completed_orders||'0')} completed<br>${escapeHtml(stats.upcoming_orders||'0')} upcoming · ${escapeHtml(stats.cancelled_orders||'0')} cancelled</p></div><div><b>Completed revenue</b><p>${money(stats.total_completed_revenue)}<br><small>Collected: ${money(stats.total_collected_amount)}</small></p></div>${bank.bank_name?`<div class="full"><b>Bank details</b><p>${escapeHtml(bank.account_holder_name)} · ${escapeHtml(bank.bank_name)}<br><small>${escapeHtml(bank.account_number)} · ${escapeHtml(bank.ifsc_code)} · ${bank.is_verified?'Verified':'Not verified'}</small></p></div>`:''}</div>`)}catch(error){modal(`<h2>Unable to load partner</h2><p>${escapeHtml(error.message)}</p>`);}}

async function coupons(){
  const [list,stats]=await Promise.all([api('/api/admin/coupons').then(unwrap),api('/api/admin/coupons/stats/summary').then(unwrap).catch(()=>({}))]);
  if(state.page!=='coupons') return;
  const rows=Array.isArray(list)?list:list.coupons||[];
  const discount=x=>x.discount_type==='PERCENTAGE'?`${Number(x.discount_value)}% off${x.max_discount_amount?`<small>up to ${money(x.max_discount_amount)}</small>`:''}`:`${money(x.discount_value)} off`;
  content.innerHTML=`<div class="page-top"><div><p class="eyebrow">PROMOTIONS</p><h2>Coupons</h2><p>Coupons offered to customers in the MyYaan app.</p></div></div><section class="metrics" style="margin-bottom:18px">${metric('ACTIVE COUPONS',escapeHtml(stats.active_coupons??0),`${escapeHtml(stats.total_coupons??0)} total · ${escapeHtml(stats.expired_coupons??0)} expired`)}${metric('REDEMPTIONS',escapeHtml(stats.total_redemptions??0),`${escapeHtml(stats.total_successful_usages??0)} successful`)}${metric('DISCOUNT GIVEN',money(stats.total_discount_given),`on ${money(stats.total_order_value_with_coupons)} of orders`)}</section>${table(['CODE','OFFER','DISCOUNT','MIN. ORDER','USED','VALIDITY','STATUS',''],rows.map(x=>`<tr><td><b>${escapeHtml(x.code)}</b><small>${escapeHtml(x.applicable_vehicle_type||'')}</small></td><td><b>${escapeHtml(x.title||'—')}</b><small>${escapeHtml(x.description||'')}</small></td><td>${discount(x)}</td><td>${money(x.min_order_value)}</td><td>${escapeHtml(x.times_used??0)}${x.usage_limit_total?` / ${escapeHtml(x.usage_limit_total)}`:''}</td><td>${date(x.start_date)}<small>${x.end_date?`to ${date(x.end_date)}`:'No end date'}</small></td><td>${status(x.computed_status||(x.is_active?'active':'inactive'))}</td><td><button class="outline coupon-details" data-id="${escapeHtml(x.id)}">View</button></td></tr>`).join(''))}`;
  document.querySelectorAll('.coupon-details').forEach(button=>button.onclick=()=>recordDetails(`/api/admin/coupons/${encodeURIComponent(button.dataset.id)}`,'Coupon'));
  bindSearch();
}
function services(){content.innerHTML=`<div class="page-top"><div><p class="eyebrow">SERVICE CATALOG</p><h2>Services & pricing</h2><p>Set your customer-facing services and starting prices.</p></div><button class="small-btn" onclick="toast('Pricing editor is ready to connect to your service-partner API.')">Edit catalog</button></div><div class="service-cards"><article class="service-card"><div class="service-icon">⚒</div><h3>Vehicle service</h3><p>General repair, scheduled maintenance, oil change, brakes, and diagnostics for cars and bikes.</p><b>From ₹499</b></article><article class="service-card"><div class="service-icon">◌</div><h3>Premium wash</h3><p>Exterior wash, interior cleaning, polishing, and detailing options for every vehicle type.</p><b>From ₹199</b></article><article class="service-card"><div class="service-icon">◉</div><h3>Puncture & tyre</h3><p>Quick puncture repair, tube replacement, tyre inspection, and wheel balancing.</p><b>From ₹99</b></article></div>`}
async function settings(){const d=await api('/api/integrations/status');content.innerHTML=`<div class="panel"><div class="panel-title"><h2>Connected services</h2></div><div class="queue-item"><div class="queue-icon">↔</div><div><b>MyYaan service API</b><small>${escapeHtml(d.configured?d.baseUrl:'Not configured')}</small></div>${status(d.configured?'connected':'not configured')}</div></div><div class="panel" style="margin-top:18px"><div class="panel-title"><h2>Signed in as</h2></div><p>${escapeHtml(state.adminName)}</p></div>`}
function bindSearch(){const s=$('#search');if(!s)return;s.oninput=()=>document.querySelectorAll('.data-table tbody tr').forEach(r=>r.style.display=r.textContent.toLowerCase().includes(s.value.toLowerCase())?'':'none')}
function modal(html){$('#modalContent').innerHTML=html;$('#modal').classList.remove('hidden');} function closeModal(){$('#modal').classList.add('hidden')}
function logout(){for(const key of ['myyaan_token','myyaan_authorization','myyaan_admin_name'])localStorage.removeItem(key);state.authorization=null;state.data={};closeModal();$('#app').classList.add('hidden');$('#loginView').classList.remove('hidden')}
$('#loginForm').onsubmit=async e=>{e.preventDefault();const error=$('#loginError');const button=$('#loginForm button[type="submit"]');error.textContent='Signing in…';button.disabled=true;try{const response=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:$('#email').value,password:$('#password').value}),signal:AbortSignal.timeout(20_000)});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.message||'Unable to sign in.');const authorization=response.headers.get('Authorization')||`Bearer ${data.token}`;state.authorization=authorization;state.adminName=data.user?.name||'Admin';localStorage.setItem('myyaan_authorization',authorization);localStorage.setItem('myyaan_admin_name',state.adminName);localStorage.removeItem('myyaan_token');error.textContent='';start()}catch(err){error.textContent=err.name==='TimeoutError'?'Login timed out. Check that the dashboard API is running and try again.':err.message}finally{button.disabled=false}};
$('#nav').onclick=e=>{const b=e.target.closest('[data-page]');if(b)setPage(b.dataset.page)};$('#logout').onclick=logout;$('#closeModal').onclick=closeModal;$('#modal').onclick=e=>{if(e.target.id==='modal')closeModal()};$('#menu').onclick=()=>$('.sidebar').classList.toggle('open');
function start(){$('#loginView').classList.add('hidden');$('#app').classList.remove('hidden');$('.avatar').textContent=state.adminName.charAt(0).toUpperCase();setPage('overview')}if(state.authorization)start();
