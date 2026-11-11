/* HARAZD WAREHOUSE — private employee dashboard and self-service account management. */
(() => {
 'use strict';
 const el = id => document.getElementById(id);
 const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const roles = {admin:'Адміністратор',manager:'Менеджер',warehouse:'Комірник',viewer:'Перегляд'};
 const repairStatuses = {new:'Нова заявка',diagnostics:'Діагностика',waiting:'Очікує запчастин',progress:'В ремонті',done:'Завершено',cancelled:'Скасовано'};
 const eventStatuses = {planned:'Планується',preparation:'Підготовка',installation:'Монтаж',live:'Проведення',dismantling:'Демонтаж',done:'Завершено',cancelled:'Скасовано'};
 const permissions = {equipment_view:'Перегляд обладнання',equipment_add:'Додавання обладнання',equipment_edit:'Редагування обладнання',directory_manage:'Категорії та місця',events_create:'Створення івентів',events_edit:'Редагування івентів',packing_create:'Пакувальні листи',packing_dispatch:'Видача обладнання',packing_return:'Повернення обладнання',repairs_manage:'Оформлення ремонтів',personnel_manage:'Керування персоналом'};
 const prettyDate = value => {
   if (!value) return '—';
   const match = String(value).match(/^\d{4}-\d{2}-\d{2}/);
   const date = new Date((match ? match[0] : String(value)) + (match ? 'T12:00:00' : ''));
   return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('uk-UA');
 };
 const info = (label,value) => `<div class="my-page-field"><small>${safe(label)}</small><strong>${safe(value ?? '—')}</strong></div>`;
 let requestId = 0;
 let currentUser = null, currentProfile = null, currentContact = null, contactsReady = false;
 function displayProfile(user, profile, contact = {}, ready = false) {
   const name = profile?.full_name || user?.user_metadata?.full_name || 'Працівник';
   const initials = name.split(/\s+/).slice(0,2).map(x => x[0] || '').join('').toUpperCase();
   const allowed = profile?.role === 'admin' ? ['Повний доступ адміністратора'] : Object.entries(permissions).filter(([key]) => profile?.permissions?.[key] === true).map(([,label])=>label);
   const status = profile ? (profile.status === 'active' ? 'Активний' : 'Неактивний') : 'Профіль працівника не призначено';
   el('myPageProfile').innerHTML = `<div class="my-page-identity"><span class="my-page-avatar">${safe(initials || '?')}</span><div><strong>${safe(name)}</strong><span>${safe(profile?.position || 'Посаду не вказано')}</span></div></div>
   <div class="my-page-account-actions"><button type="button" id="myPageEditProfile" ${(!ready || !profile || profile.status !== 'active') ? 'disabled' : ''}>✎ Редагувати інформацію</button><button type="button" id="myPageChangePassword">Змінити пароль</button></div>
   <div class="my-page-fields">${info('Email',user?.email || profile?.email)}${info('Роль',profile ? roles[profile.role] || profile.role : '—')}${info('Статус',status)}${info('Посада',profile?.position || '—')}${info('Телефон',contact?.phone || '—')}${info('Telegram',contact?.telegram || '—')}${info('Місто',contact?.city || '—')}${info('Дата народження',prettyDate(contact?.birth_date))}${info('Email підтверджено',user?.email_confirmed_at ? 'Так' : 'Ні')}${info('ID користувача',user?.id)}</div>
   <h3>Про себе</h3><p class="my-page-about">${safe(contact?.about || 'Інформацію ще не додано.')}</p>
   <h3>Мої дозволи</h3><div class="my-page-permissions">${allowed.length ? allowed.map(x => `<span>${safe(x)}</span>`).join('') : '<p class="my-page-empty">Дозволи не призначено.</p>'}</div><p class="my-page-help">${ready ? 'Особисті контактні дані доступні тільки вам. ' : 'Для редагування контактів виконайте SQL-оновлення. '}ПІБ, посаду, роль та дозволи змінює адміністратор в розділі «Персонал». Пароль ніколи не відображається.</p>`;
 }
 function openContactEditor() {
   if (!currentUser || !currentProfile || currentProfile.status !== 'active' || !contactsReady) return;
   const form = el('myPageContactForm');
   form.reset();
   for (const key of ['phone','telegram','city','birth_date','about']) form.elements.namedItem(key).value = currentContact?.[key] || '';
   el('myPageContactFeedback').textContent = '';
   el('myPageContactDialog').showModal();
 }
 async function saveContact(event) {
   event.preventDefault();
   const form = event.currentTarget;
   if (!contactsReady || !currentUser || !currentProfile || currentProfile.status !== 'active') return;
   const btn = form.querySelector('button[type="submit"]');
   const feedback = el('myPageContactFeedback');
   const value = name => String(form.elements.namedItem(name).value || '').trim();
   const values = {user_id:currentUser.id,phone:value('phone'),telegram:value('telegram'),city:value('city'),birth_date:value('birth_date') || null,about:value('about'),updated_at:new Date().toISOString()};
   btn.disabled = true;
   feedback.textContent = 'Зберігаємо…';
   try {
     const {data,error} = await db.from('warehouse_staff_contact').upsert(values,{onConflict:'user_id'}).select().single();
     if (error) throw error;
     currentContact = data;
     displayProfile(currentUser,currentProfile,currentContact,true);
     window.harazdMyPageExtras?.restoreAvatar?.();
     el('myPageContactDialog').close();
     if (typeof toast === 'function') toast('Особисту інформацію збережено.');
   } catch (error) {
     feedback.textContent = 'Не вдалося зберегти: ' + (error?.message || error);
   } finally {btn.disabled=false;}
 }
 function openPasswordDialog() {
   if (!currentUser?.email) return;
   el('myPagePasswordForm').reset();
   el('myPagePasswordFeedback').textContent = '';
   el('myPagePasswordDialog').showModal();
 }
 async function savePassword(event) {
   event.preventDefault();
   const form = event.currentTarget;
   const feedback = el('myPagePasswordFeedback');
   const button = form.querySelector('button[type="submit"]');
   const previous = form.elements.namedItem('current_password').value;
   const next = form.elements.namedItem('new_password').value;
   const confirmation = form.elements.namedItem('confirm_password').value;
   if (!currentUser?.email) { feedback.textContent='Сесія недоступна. Увійдіть повторно.';return; }
   if (next.length < 8) {feedback.textContent='Новий пароль має містити щонайменше 8 символів.';return;}
   if (next !== confirmation) {feedback.textContent='Підтвердження не збігається з новим паролем.';return;}
   if (next === previous) {feedback.textContent='Новий пароль має відрізнятися від поточного.';return;}
   button.disabled = true;
   feedback.textContent='Перевіряємо поточний пароль…';
   try {
     const {data:verified,error:verifyError} = await db.auth.signInWithPassword({email:currentUser.email,password:previous});
     if (verifyError || verified?.user?.id !== currentUser.id) throw Error('Не вдалося підтвердити поточний пароль. Перевірте його та спробуйте ще раз.');
     feedback.textContent='Змінюємо пароль…';
     const {error} = await db.auth.updateUser({password:next});
     if (error) throw error;
     form.reset();
     el('myPagePasswordDialog').close();
     if (typeof toast === 'function') toast('Пароль успішно змінено.');
   } catch (error) {
     feedback.textContent = error?.message || 'Не вдалося змінити пароль.';
   } finally {button.disabled=false;}
 }

 function repairView(data, equipmentById) {
   el('myRepairsCount').textContent = String(data.length);
   el('myPageRepairs').innerHTML = data.length ? data.map(job => {
     const equipment = equipmentById.get(String(job.equipment_id)) || {};
     const label = repairStatuses[job.status] || job.status || '—';
     return `<details class="my-page-entry"><summary><span class="my-page-entry-main"><strong>${safe(equipment.name || job.problem || 'Ремонт обладнання')}</strong><small>${safe(equipment.eq_id || 'Обладнання')} · до ${safe(prettyDate(job.due_on))}</small></span><span class="my-page-state ${job.status==='done'?'my-page-state-done':''}">${safe(label)}</span></summary><div class="my-page-entry-detail">${info('Проблема',job.problem || '—')}${info('Початок',prettyDate(job.created_at))}${info('Термін',prettyDate(job.due_on))}${info('Завершено',prettyDate(job.completed_on))}${info('Призначено',job.assignee || '—')}</div></details>`;
   }).join('') : '<p class="my-page-empty">Наразі вам не призначено ремонтів.</p>';
 }
 function eventView(data) {
   el('myEventsCount').textContent = String(data.length);
   el('myPageEvents').innerHTML = data.length ? data.map(event => {
     const label = eventStatuses[event.status] || event.status || '—';
     return `<details class="my-page-entry"><summary><span class="my-page-entry-main"><strong>${safe(event.name)}</strong><small>${safe(prettyDate(event.event_date))}${event.event_end_date && event.event_end_date !== event.event_date ? ' – '+safe(prettyDate(event.event_end_date)) : ''} · ${safe(event.location || 'Без локації')}</small></span><span class="my-page-state ${event.status==='done'?'my-page-state-done':''}">${safe(label)}</span></summary><div class="my-page-entry-detail">${info('Монтаж',prettyDate(event.setup_date))}${info('Подія',prettyDate(event.event_date))}${info('Демонтаж',prettyDate(event.teardown_date))}${info('Локація',event.location || '—')}${info('Замовник',event.client || '—')}</div></details>`;
   }).join('') : '<p class="my-page-empty">Вам ще не призначено подій. Адміністратор може призначити вас під час редагування івенту.</p>';
 }
 async function load() {
   const key = ++requestId;
   if (!el('myPageProfile')) return;
   currentUser=null;currentProfile=null;currentContact=null;contactsReady=false;
   el('myPageProfile').textContent = 'Завантаження профілю…';
   el('myPageRepairs').textContent = 'Завантаження призначених ремонтів…';
   el('myPageEvents').textContent = 'Завантаження призначених подій…';
   el('myRepairsCount').textContent = '0';
   el('myEventsCount').textContent = '0';
   try {
     if (typeof db === 'undefined' || !db) throw Error('З’єднання з Supabase не налаштоване');
     const {data:auth,error:authError} = await db.auth.getUser();
     if (authError) throw authError;
     const user = auth?.user;
     if (!user) throw Error('Увійдіть до акаунта');
     const {data:profile,error:profileError} = await db.from('warehouse_staff').select('*').eq('user_id',user.id).maybeSingle();
     if (profileError) throw profileError;
     if (key !== requestId) return;
     let contact=null, contactWarning='';
     try {
       const result=await db.from('warehouse_staff_contact').select('phone,telegram,city,birth_date,about,updated_at').eq('user_id',user.id).maybeSingle();
       if(result.error) throw result.error;
       contact=result.data || {};
       contactsReady=true;
     } catch(error) {
       contactWarning='Особисті контакти недоступні. Перевірте SETUP_MY_PAGE_CONTACTS.sql.';
     }
     if (key !== requestId) return;
     currentUser=user;currentProfile=profile;currentContact=contact;
     displayProfile(user,profile,contact,contactsReady);
     window.harazdMyPageExtras?.load({user,profile});
     if (!profile || profile.status !== 'active') {
       if (typeof toast === 'function') toast('Щоб бачити свої роботи, потрібен активний профіль працівника.' + (contactWarning ? ' ' + contactWarning : ''),true);
       el('myPageRepairs').innerHTML = '<p class="my-page-empty">Немає активного профілю працівника.</p>';
       el('myPageEvents').innerHTML = '<p class="my-page-empty">Немає активного профілю працівника.</p>';
       return;
     }
     const [repairResponse,assignmentResponse] = await Promise.allSettled([
       db.rpc('warehouse_my_repairs'),
       db.from('warehouse_event_staff').select('event_id').eq('user_id',user.id)
     ]);
     if (key !== requestId) return;
     let repairs = [], events = [];
     const warnings = [];
     if (repairResponse.status === 'fulfilled' && !repairResponse.value.error) {
       repairs = Array.isArray(repairResponse.value.data) ? repairResponse.value.data : [];
       const ids = [...new Set(repairs.map(x=>x.equipment_id).filter(Boolean))];
       let equipmentById = new Map();
       if(ids.length) {
         const {data,error} = await db.from('equipment').select('id,name,eq_id').in('id',ids);
         if (!error) equipmentById = new Map((data||[]).map(x => [String(x.id),x]));
       }
       if(key !== requestId) return;
       repairView(repairs,equipmentById);
     } else {
       el('myPageRepairs').innerHTML = '<p class="my-page-empty">Не вдалося завантажити особисті ремонти. Перевірте SQL-оновлення.</p>';
       warnings.push('ремонти');
     }
     if (assignmentResponse.status === 'fulfilled' && !assignmentResponse.value.error) {
       const ids = [...new Set((assignmentResponse.value.data||[]).map(x=>x.event_id))];
       if (ids.length) {
         const {data,error} = await db.from('warehouse_events').select('*').in('id',ids).order('event_date',{ascending:true});
         if (error) {
           warnings.push('події');
           el('myPageEvents').innerHTML = '<p class="my-page-empty">Не вдалося отримати призначені події. Перевірте дозволи доступу.</p>';
         } else events = data||[];
       }
       if (!warnings.includes('події')) eventView(events);
     } else {
       el('myPageEvents').innerHTML = '<p class="my-page-empty">Не вдалося завантажити призначення подій. Перевірте SQL-оновлення.</p>';
       warnings.push('події');
     }
     if (key !== requestId) return;
     window.harazdMyPageExtras?.setAppointments({repairs,events});
     const warningMessage = [contactWarning, warnings.length ? 'Не всі дані завантажені: '+warnings.join(', ')+'.' : ''].filter(Boolean).join(' ');
     if (warningMessage && typeof toast === 'function') toast(warningMessage,true);
   } catch (error) {
     if (key !== requestId) return;
     if (typeof toast === 'function') toast('Не вдалося завантажити профіль: ' + (error?.message || error),true);
     el('myPageProfile').innerHTML = '<p class="my-page-empty">Дані профілю недоступні.</p>';
   }
 }
 el('myPageProfile')?.addEventListener('click',event=>{
   if(event.target.closest('#myPageEditProfile')) openContactEditor();
   if(event.target.closest('#myPageChangePassword')) openPasswordDialog();
 });
 el('myPageContactForm')?.addEventListener('submit',saveContact);
 el('myPagePasswordForm')?.addEventListener('submit',savePassword);
 for(const [id,dialog] of [['myPageContactCancel','myPageContactDialog'],['myPagePasswordCancel','myPagePasswordDialog']]){
   el(id)?.addEventListener('click',()=>el(dialog).close());
 }
 window.harazdMyPage = {load};
})();
