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

// ---------- Service partners ----------
// The list page filters on the server. Opening a partner shows its own page
// with profile, stats and orders; state.data.partnerId marks that page as open.
const partnerPath = id => `/api/admin/service-partners/${encodeURIComponent(id)}`;
const orderTabs = [['all','All','total_orders'],['upcoming','Upcoming','upcoming_orders'],['completed','Completed','completed_orders'],['cancelled','Cancelled','cancelled_orders']];
const ORDERS_PER_PAGE = 10;

async function vendors(page=1){
  if(state.data.partnerId) return partnerPage(state.data.partnerId);
  state.data.partnerListPage=page;
  const filters=state.data.partnerFilters||{};
  const query=new URLSearchParams({page:String(page),limit:'10'});
  for(const [key,value] of Object.entries(filters)) if(value&&value!=='all') query.set(key,value);
  const response=unwrap(await api(`/api/admin/service-partners?${query}`));
  if(state.page!=='vendors'||state.data.partnerId) return;
  const rows=response.partners||[];
  const pagination=response.pagination||{};
  const active=Object.entries(filters).filter(([,v])=>v&&v!=='all').length;
  const opt=(value,label,current)=>`<option value="${value}" ${current===value?'selected':''}>${label}</option>`;
  content.innerHTML=`<div class="page-top"><div><p class="eyebrow">PARTNER NETWORK</p><h2>Service partners</h2><p>Live data from the MyYaan service-partner API.</p></div></div>
  <section class="panel table-panel">
    <div class="filters">
      <input id="pf_search" class="span-2" value="${escapeHtml(filters.search||'')}" placeholder="Search name, owner, mobile, city or pincode" />
      <select id="pf_is_active">${opt('all','All statuses',filters.is_active||'all')}${opt('true','Active',filters.is_active)}${opt('false','Inactive',filters.is_active)}</select>
      <select id="pf_onboarding_status">${opt('','All onboarding',filters.onboarding_status||'')}${opt('completed','Onboarding completed',filters.onboarding_status)}${opt('pending','Onboarding pending',filters.onboarding_status)}</select>
      <label>City<input id="pf_city" value="${escapeHtml(filters.city||'')}" placeholder="e.g. Gurugram" /></label>
      <label>Pincode<input id="pf_pincode" value="${escapeHtml(filters.pincode||'')}" placeholder="e.g. 122001" inputmode="numeric" /></label>
      <label>Registered from<input type="date" id="pf_date_from" value="${escapeHtml(filters.date_from||'')}" /></label>
      <label>Registered to<input type="date" id="pf_date_to" value="${escapeHtml(filters.date_to||'')}" /></label>
    </div>
    <div class="filter-foot"><small><b>${escapeHtml(pagination.total??rows.length)}</b> partner${(pagination.total??rows.length)==1?'':'s'} found${active?` · ${active} filter${active===1?'':'s'} applied`:''}</small>${active?'<button class="link-btn" id="pf_clear">Clear filters</button>':''}</div>
    <table class="data-table"><thead><tr><th>PARTNER</th><th>OWNER</th><th>LOCATION</th><th>REGISTERED</th><th>ONBOARDING</th><th>BOOKINGS</th><th>STATUS</th><th></th></tr></thead><tbody>${rows.length?rows.map(x=>`<tr>
      <td><b>${escapeHtml(x.service_center_name)}</b><small>${escapeHtml(x.owner_email||'')}</small></td>
      <td><b>${escapeHtml(x.owner_name||'—')}</b><small>${escapeHtml(x.owner_mobile||'')}</small></td>
      <td>${escapeHtml([x.city,x.state].filter(Boolean).join(', ')||'—')}<br><small>${escapeHtml(x.pincode||'')}</small></td>
      <td>${date(x.created_at)}</td>
      <td>${status(x.onboarding_status||'pending')}</td>
      <td><button class="link-btn partner-orders" data-id="${escapeHtml(x.service_center_id)}" title="See this partner's orders">${escapeHtml(x.total_bookings_count||'0')}</button></td>
      <td>${status(x.is_active?'active':'inactive')}</td>
      <td><div class="row-actions"><button class="small-btn partner-open" data-id="${escapeHtml(x.service_center_id)}">Details</button><button class="outline partner-orders" data-id="${escapeHtml(x.service_center_id)}">Orders</button></div></td>
    </tr>`).join(''):'<tr><td colspan="8" class="empty">No service partners match these filters.</td></tr>'}</tbody></table>
    ${pager(pagination,page,rows.length,'partner')}
  </section>`;
  const keys=['search','is_active','onboarding_status','city','pincode','date_from','date_to'];
  const load=()=>{state.data.partnerFilters=Object.fromEntries(keys.map(k=>[k,$(`#pf_${k}`).value.trim()]));vendors(1).catch(e=>toast(e.message))};
  keys.forEach(k=>$(`#pf_${k}`).onchange=load);
  if($('#pf_clear')) $('#pf_clear').onclick=()=>{state.data.partnerFilters={};vendors(1).catch(e=>toast(e.message))};
  $('#pagePrevious').onclick=()=>vendors(page-1).catch(e=>toast(e.message));
  $('#pageNext').onclick=()=>vendors(page+1).catch(e=>toast(e.message));
  document.querySelectorAll('.partner-open').forEach(b=>b.onclick=()=>openPartner(b.dataset.id));
  document.querySelectorAll('.partner-orders').forEach(b=>b.onclick=()=>openPartner(b.dataset.id,'orders'));
}

// view is 'details' (profile, stats, bank) or 'orders' (order list with filters).
function openPartner(id, view='details'){
  state.data.partnerId=String(id);
  state.data.partnerOrders={tab:'all',filters:{},page:1,rows:[]};
  state.data.partnerView=view;
  content.innerHTML='<div class="empty">Loading service partner…</div>';
  window.scrollTo(0,0);
  partnerPage(state.data.partnerId).catch(e=>{content.innerHTML=`<div class="panel empty">${escapeHtml(e.message)}<br><button class="link-btn" id="partnerBack">← Back to service partners</button></div>`;$('#partnerBack').onclick=closePartner;});
}
function closePartner(){state.data.partnerId=null;vendors(state.data.partnerListPage||1).catch(e=>toast(e.message))}

async function partnerPage(id){
  const p=unwrap(await api(partnerPath(id)));
  if(state.page!=='vendors'||state.data.partnerId!==id) return;
  const ps=state.data.partnerOrders||(state.data.partnerOrders={tab:'all',filters:{},page:1,rows:[]});
  const stats=p.order_stats||{}, t=p.timing_slots||{}, bank=p.bank_details||{}, ob=p.onboarding_summary||{};
  const n=k=>Number(stats[k]||0);
  const pct=v=>n('total_orders')?`${Math.round(v/n('total_orders')*100)}%`:'—';
  const address=[p.address_line_1,p.address_line_2,p.city,p.state,p.pincode].filter(Boolean).join(', ');
  const time=v=>{if(!v)return '—';const [h,m]=String(v).split(':');const d=new Date();d.setHours(+h,+m||0);return d.toLocaleTimeString('en-IN',{hour:'numeric',minute:'2-digit'})};
  const check=(done,label)=>`<li class="${done?'done':''}">${done?'✓':'○'} ${label}</li>`;
  const vehicles=(p.supported_vehicles||[]);
  const view=state.data.partnerView==='orders'?'orders':'details';
  const detailsView=`
  <section class="metrics">
    ${metric('TOTAL ORDERS',n('total_orders'),`${n('completed_orders')} completed`)}
    ${metric('UPCOMING',n('upcoming_orders'),`${n('cancelled_orders')} cancelled`)}
    ${metric('COMPLETED REVENUE',money(stats.total_completed_revenue),`${money(stats.total_collected_amount)} collected`)}
    ${metric('COMPLETION RATE',pct(n('completed_orders')),`${pct(n('cancelled_orders'))} cancelled`)}
  </section>
  <section class="info-grid">
    <div class="panel"><h3>Owner</h3><p><b>${escapeHtml(p.owner_name||'—')}</b><br>${p.owner_mobile?`<a href="tel:${escapeHtml(p.owner_mobile)}">${escapeHtml(p.owner_mobile)}</a>`:''}<br>${p.owner_email?`<a href="mailto:${escapeHtml(p.owner_email)}">${escapeHtml(p.owner_email)}</a>`:''}</p></div>
    <div class="panel"><h3>Location</h3><p>${escapeHtml(address||'—')}${p.latitude&&p.longitude?`<br><a href="https://www.google.com/maps?q=${encodeURIComponent(`${p.latitude},${p.longitude}`)}" target="_blank" rel="noopener">Open in Google Maps ↗</a>`:''}</p></div>
    <div class="panel"><h3>Opening hours</h3><p>${t.is_open_24x7?'<b>Open 24×7</b>':`<b>${time(t.opening_time)} – ${time(t.closing_time)}</b>`}<br><small>${escapeHtml((t.open_days||[]).map(d=>d.slice(0,3).toLowerCase()).join(', ')||'No open days set')}</small><br><small>${escapeHtml(t.slot_duration_hours||'—')}-hour slots</small></p></div>
    <div class="panel"><h3>Capacity per slot</h3><p>Walk-in: <b>${escapeHtml(t.default_walk_in_capacity??0)}</b><br>Pick & drop: <b>${escapeHtml(t.default_pick_n_drop_capacity??0)}</b><br>Home service: <b>${escapeHtml(t.default_home_service_capacity??0)}</b></p></div>
    <div class="panel"><h3>Supported vehicles</h3><div class="chips">${vehicles.length?vehicles.map(v=>`<span>${escapeHtml(v.vehicle_category)} · ${escapeHtml(v.service_name)}</span>`).join(''):'<small>None set</small>'}</div></div>
    <div class="panel"><h3>Onboarding</h3><ul class="checklist">${check(ob.is_personal_details_completed,'Personal details')}${check(ob.is_service_center_details_completed,'Service center details')}${check(ob.is_services_completed,'Services')}${check(bank.is_verified,'Bank account verified')}</ul></div>
    <div class="panel span-3"><h3>Bank details</h3>${bank.bank_name||bank.account_number?`<p><b>${escapeHtml(bank.account_holder_name||'—')}</b> · ${escapeHtml(bank.bank_name||'')} · IFSC ${escapeHtml(bank.ifsc_code||'—')} · ${bank.is_verified?status('verified'):status('not verified')}<br>Account <span id="acct">•••• ${escapeHtml(String(bank.account_number||'').slice(-4))}</span> ${bank.account_number?'<button class="link-btn" id="acctShow">Show</button>':''}</p>`:'<p><small>No bank details added yet.</small></p>'}</div>
  </section>`;
  const ordersView=`
  <section class="panel table-panel" id="partnerOrders">
    <div class="panel-title"><h2>Orders</h2><button id="ordersExport">Export CSV ↓</button></div>
    <div class="tabs">${orderTabs.map(([key,label,stat])=>`<button class="tab ${ps.tab===key?'active':''}" data-tab="${key}">${label}<span>${n(stat)}</span></button>`).join('')}</div>
    <div id="ordersFilters"></div><div id="ordersList"><div class="empty">Loading orders…</div></div>
  </section>`;
  content.innerHTML=`<button class="back-link" id="partnerBack">← All service partners</button>
  <div class="page-top partner-head">
    <div class="partner-id">${p.service_center_pic_url?`<img class="partner-pic" src="${escapeHtml(p.service_center_pic_url)}" alt="" onerror="this.remove()">`:`<div class="partner-pic">${escapeHtml(String(p.service_center_name||'?').charAt(0).toUpperCase())}</div>`}
      <div><p class="eyebrow">SERVICE PARTNER · #${escapeHtml(p.service_center_id||id)}</p><h2>${escapeHtml(p.service_center_name||'Service partner')}</h2><p>${escapeHtml(address||'No address on file')}</p><div class="badges">${status(p.is_active?'active':'inactive')} ${status(ob.status||'pending')}</div></div>
    </div>
    <div class="head-actions"><button class="outline" id="partnerEdit">Edit details</button><button class="${p.is_active?'danger':'small-btn'}" id="partnerToggle">${p.is_active?'Disable partner':'Enable partner'}</button></div>
  </div>
  <div class="view-switch"><button class="${view==='details'?'active':''}" data-view="details">Details</button><button class="${view==='orders'?'active':''}" data-view="orders">Orders <span>${n('total_orders')}</span></button></div>
  ${view==='details'?detailsView:ordersView}`;
  $('#partnerBack').onclick=closePartner;
  $('#partnerEdit').onclick=()=>editPartner(p);
  $('#partnerToggle').onclick=()=>togglePartner(p);
  document.querySelectorAll('.view-switch button').forEach(b=>b.onclick=()=>{if(b.dataset.view===view)return;state.data.partnerView=b.dataset.view;partnerPage(id).catch(e=>toast(e.message))});
  if(view==='details'){
    if($('#acctShow')) $('#acctShow').onclick=e=>{$('#acct').textContent=bank.account_number;e.target.remove()};
    return;
  }
  document.querySelectorAll('#partnerOrders .tab').forEach(b=>b.onclick=()=>{ps.tab=b.dataset.tab;ps.page=1;ps.filters={};document.querySelectorAll('#partnerOrders .tab').forEach(x=>x.classList.toggle('active',x===b));loadPartnerOrders(id)});
  $('#ordersExport').onclick=()=>exportOrders(p);
  await loadPartnerOrders(id);
}

// The orders API pages by tab only, so load the whole tab once and
// search/filter/paginate it here; partners have few enough orders for that.
async function loadPartnerOrders(id){
  const ps=state.data.partnerOrders, tab=ps.tab;
  $('#ordersList').innerHTML='<div class="empty">Loading orders…</div>';
  try{
    const rows=[];
    for(let page=1;page<=20;page++){
      const d=unwrap(await api(`${partnerPath(id)}/orders?tab=${tab}&page=${page}&limit=100`));
      rows.push(...(d.orders||[]));
      if(page>=(d.pagination?.totalPages||1)) break;
    }
    if(state.data.partnerId!==id||ps.tab!==tab||!$('#ordersList')) return;
    ps.rows=rows;
  }catch(e){ if($('#ordersList')) $('#ordersList').innerHTML=`<div class="empty">${escapeHtml(e.message)}</div>`; return; }
  const f=ps.filters;
  const uniq=k=>[...new Set(ps.rows.map(r=>r[k]).filter(Boolean))].sort();
  const opts=(k,label)=>`<option value="">${label}</option>${uniq(k).map(v=>`<option value="${escapeHtml(v)}" ${f[k]===v?'selected':''}>${escapeHtml(String(v).replaceAll('_',' ').toLowerCase())}</option>`).join('')}`;
  $('#ordersFilters').innerHTML=`<div class="filters">
    <input id="of_search" class="span-2" value="${escapeHtml(f.search||'')}" placeholder="Search booking no., customer, mobile or vehicle no." />
    <select id="of_booking_status">${opts('booking_status','All booking statuses')}</select>
    <select id="of_payment_status">${opts('payment_status','All payment statuses')}</select>
    <select id="of_service_name">${opts('service_name','All services')}</select>
    <select id="of_payment_mode">${opts('payment_mode','All payment modes')}</select>
    <label>Service date from<input type="date" id="of_from" value="${escapeHtml(f.from||'')}" /></label>
    <label>Service date to<input type="date" id="of_to" value="${escapeHtml(f.to||'')}" /></label>
  </div>`;
  const keys=['search','booking_status','payment_status','service_name','payment_mode','from','to'];
  keys.forEach(k=>{const el=$(`#of_${k}`);el[k==='search'?'oninput':'onchange']=()=>{f[k]=el.value.trim();ps.page=1;renderPartnerOrders(id)}});
  renderPartnerOrders(id);
}

function filteredOrders(){
  const {rows=[],filters:f={}}=state.data.partnerOrders||{};
  const q=(f.search||'').toLowerCase();
  return rows.filter(o=>{
    if(q&&![o.booking_number,o.customer_name,o.customer_mobile,o.vehicle_number].some(v=>String(v||'').toLowerCase().includes(q))) return false;
    for(const k of ['booking_status','payment_status','service_name','payment_mode']) if(f[k]&&o[k]!==f[k]) return false;
    const day=String(o.booking_date||'').slice(0,10);
    if(f.from&&day<f.from) return false;
    if(f.to&&day>f.to) return false;
    return true;
  });
}

function renderPartnerOrders(id){
  const ps=state.data.partnerOrders, list=$('#ordersList');
  if(!list) return;
  const rows=filteredOrders();
  const pages=Math.max(1,Math.ceil(rows.length/ORDERS_PER_PAGE));
  ps.page=Math.min(ps.page,pages);
  const shown=rows.slice((ps.page-1)*ORDERS_PER_PAGE,ps.page*ORDERS_PER_PAGE);
  const live=rows.filter(o=>o.booking_status!=='CANCELLED');
  const value=live.reduce((a,o)=>a+Number(o.final_amount||0),0);
  const paid=rows.filter(o=>o.payment_status==='PAID').length;
  list.innerHTML=`<div class="order-summary"><span><b>${rows.length}</b> order${rows.length===1?'':'s'}${rows.length!==ps.rows.length?` of ${ps.rows.length}`:''}</span><span>Order value <b>${money(value)}</b></span><span>Paid <b>${paid}</b></span><span>Customers <b>${new Set(rows.map(o=>o.customer_id??o.customer_mobile)).size}</b></span></div>
  <div class="table-scroll"><table class="data-table"><thead><tr><th>BOOKING</th><th>CUSTOMER</th><th>SERVICE</th><th>VEHICLE</th><th>SLOT</th><th>AMOUNT</th><th>PAYMENT</th><th>STATUS</th><th></th></tr></thead><tbody>${shown.length?shown.map(o=>`<tr>
    <td><b>${escapeHtml(o.booking_number)}</b><small>Booked ${date(o.created_at)}</small></td>
    <td><b>${escapeHtml(o.customer_name||'—')}</b><small>${escapeHtml(o.customer_mobile||'')}</small></td>
    <td>${escapeHtml(o.service_name||'—')}<br><small>${escapeHtml([o.sub_service_name,o.service_option_name].filter(Boolean).join(' · '))}</small></td>
    <td>${escapeHtml([o.vehicle_company_name,o.vehicle_model_name].filter(Boolean).join(' ')||'—')}<br><small>${escapeHtml(o.vehicle_number||'')}</small></td>
    <td>${date(o.booking_date)}<br><small>${escapeHtml(o.booking_time_slot||'')}</small></td>
    <td>${money(o.final_amount)}<br><small>${escapeHtml(String(o.payment_mode||'').replaceAll('_',' ').toLowerCase())}</small></td>
    <td>${status(o.payment_status)}</td><td>${status(o.booking_status)}</td>
    <td><button class="outline order-view" data-id="${escapeHtml(o.booking_id)}">View</button></td>
  </tr>`).join(''):`<tr><td colspan="9" class="empty">${ps.rows.length?'No orders match these filters.':'No orders in this tab yet.'}</td></tr>`}</tbody></table></div>
  <div class="toolbar" style="margin-top:18px"><small>Page ${ps.page} of ${pages}</small><div><button class="outline" id="ordersPrev" ${ps.page<=1?'disabled':''}>Previous</button> <button class="outline" id="ordersNext" ${ps.page>=pages?'disabled':''}>Next</button></div></div>`;
  $('#ordersPrev').onclick=()=>{ps.page--;renderPartnerOrders(id)};
  $('#ordersNext').onclick=()=>{ps.page++;renderPartnerOrders(id)};
  list.querySelectorAll('.order-view').forEach(b=>b.onclick=()=>recordDetails(`${partnerPath(id)}/orders/${encodeURIComponent(b.dataset.id)}`,'Booking'));
}

function exportOrders(p){
  const rows=filteredOrders();
  if(!rows.length) return toast('No orders to export.');
  const cols=['booking_number','created_at','booking_date','booking_time_slot','customer_name','customer_mobile','service_name','sub_service_name','service_option_name','vehicle_company_name','vehicle_model_name','vehicle_number','final_amount','payment_mode','payment_status','booking_status'];
  const cell=v=>`"${String(v??'').replaceAll('"','""')}"`;
  const csv=[cols.join(','),...rows.map(o=>cols.map(c=>cell(o[c])).join(','))].join('\n');
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  a.download=`${String(p.service_center_name||'partner').replace(/[^\w-]+/g,'_')}_${state.data.partnerOrders.tab}_orders.csv`;
  a.click();URL.revokeObjectURL(a.href);
}

function editPartner(p){
  const [first='',...rest]=String(p.owner_name||'').trim().split(/\s+/);
  const field=(name,label,value,{full=false,type='text'}={})=>`<label class="${full?'full':''}">${label}<input name="${name}" type="${type}" value="${escapeHtml(value??'')}" ${type==='number'?'step="any"':''} /></label>`;
  modal(`<h2>Edit partner</h2><p>Changes are saved to the MyYaan API.</p><form id="partnerForm" class="form-grid">
    ${field('service_center_name','Service center name',p.service_center_name,{full:true})}
    ${field('address_line_1','Address line 1',p.address_line_1,{full:true})}
    ${field('address_line_2','Address line 2',p.address_line_2,{full:true})}
    ${field('city','City',p.city)}${field('state','State',p.state)}
    ${field('pincode','Pincode',p.pincode)}${field('owner_email','Owner email',p.owner_email,{type:'email'})}
    ${field('owner_first_name','Owner first name',first)}${field('owner_last_name','Owner last name',rest.join(' '))}
    ${field('latitude','Latitude',p.latitude,{type:'number'})}${field('longitude','Longitude',p.longitude,{type:'number'})}
    <div class="error full" id="partnerFormError"></div>
    <div class="full form-actions"><button type="button" class="outline" id="partnerCancel">Cancel</button><button type="submit" class="small-btn">Save changes</button></div>
  </form>`);
  $('#partnerCancel').onclick=closeModal;
  $('#partnerForm').onsubmit=async e=>{
    e.preventDefault();
    const body=Object.fromEntries([...new FormData(e.target)].map(([k,v])=>[k,String(v).trim()]));
    if(!body.service_center_name) return $('#partnerFormError').textContent='Service center name is required.';
    // Optional fields are sent only when filled, so blanks don't overwrite data.
    for(const k of ['address_line_2','latitude','longitude']) if(body[k]==='') delete body[k];
    for(const k of ['latitude','longitude']) if(k in body) body[k]=Number(body[k]);
    const button=e.target.querySelector('[type=submit]');button.disabled=true;button.textContent='Saving…';
    try{
      const r=await api(partnerPath(p.service_center_id),{method:'PUT',body:JSON.stringify(body)});
      closeModal();toast(r.message||'Partner details saved.');
      partnerPage(state.data.partnerId).catch(err=>toast(err.message));
    }catch(err){$('#partnerFormError').textContent=err.message;button.disabled=false;button.textContent='Save changes';}
  };
}

async function togglePartner(p){
  const disabling=p.is_active;
  if(!confirm(`${disabling?'Disable':'Enable'} "${p.service_center_name}"?\n\nThe partner will be marked ${disabling?'inactive':'active'}.`)) return;
  try{
    const r=await api(`${partnerPath(p.service_center_id)}/toggle-status`,{method:'PATCH'});
    toast(r.message||`Partner ${disabling?'disabled':'enabled'}.`);
    await partnerPage(state.data.partnerId);
  }catch(e){toast(e.message)}
}


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
$('#nav').onclick=e=>{const b=e.target.closest('[data-page]');if(b){state.data.partnerId=null;setPage(b.dataset.page)}};$('#logout').onclick=logout;$('#closeModal').onclick=closeModal;$('#modal').onclick=e=>{if(e.target.id==='modal')closeModal()};$('#menu').onclick=()=>$('.sidebar').classList.toggle('open');
function start(){$('#loginView').classList.add('hidden');$('#app').classList.remove('hidden');$('.avatar').textContent=state.adminName.charAt(0).toUpperCase();setPage('overview')}if(state.authorization)start();
