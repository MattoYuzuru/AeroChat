import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter} from 'react-router-dom';
import {LegacyAppShell} from '../../src/app/AppShell.tsx';
import direct from '../../src/pages/ChatsPage.module.css';
import group from '../../src/pages/GroupsPage.module.css';
import '@fontsource/pt-sans/400.css';import '@fontsource/pt-sans/700.css';import '@fontsource/ibm-plex-mono/400.css';
import '../../src/styles/reset.css';import '../../src/styles/tokens.css';import '../../src/styles/global.css';
function Conversation(){
 const params=new URLSearchParams(location.search),isGroup=params.get('lane')==='group',s=isGroup?group:direct,count=Number(params.get('count')??2);
 const [draft,setDraft]=useState(''),[info,setInfo]=useState(false),[showList,setShowList]=useState(false),[calls,setCalls]=useState(0),[refreshes,setRefreshes]=useState(0);
 const state=params.get('state')??'normal';
 const title=state==='error'?'Переписка с очень длинным именем собеседника или группы':'Переписка';
 const header=<section className={isGroup?`${s.panelCard} ${s.threadHeroCard}`:s.threadHero} data-testid="thread-header"><div className={isGroup?s.splitHeader:s.threadHeroRow}><button className={`${isGroup?s.groupIdentityButton:''} ${s.threadIdentityButton}`} onClick={()=>setInfo(true)} type="button"><div className={s.threadIdentity}><span className={`${s.avatarBadge} ${s.avatarBadgeLarge}`} aria-hidden="true">ПП</span><div>
   {isGroup?<><p className={s.cardLabel}>Группа</p><h2 className={s.threadTitle}>{title}</h2><p className={s.threadEyebrow}>Текущая роль: участник.</p><p className={s.threadDescription}>Участников: 3</p></>:<><div className={s.chatItemHeader}><h3 className={s.threadTitle}>{title}</h3><span className={s.threadDescription}>@layout.fixture</span></div><p className={s.threadEyebrow}>В сети</p></>}
  </div></div></button><div className={s.threadStatusRow}><span className={isGroup?s.statusPill:s.statusBadge}>Новых: 2</span><span className={s.metaTag}>{count} сообщений</span>{isGroup&&<span className={s.statusPill}>Можно писать</span>}
   {params.get('lane')!=='self'&&<button className={s.iconButton} aria-label={isGroup?'Управление звонком':'Позвонить'} onClick={()=>setCalls(calls+1)} type="button">☎</button>}
   {isGroup&&<button className={s.secondaryButton} onClick={()=>setShowList(true)} type="button">Назад к списку</button>}
  </div></div></section>;
 const composer=<section className={s.composerCard} data-testid="composer"><form className={s.composer}>
  {state==='reply'&&<section className={s.replyComposerCard}>Ответ на предыдущее сообщение <button type="button">Отменить ответ</button></section>}
  {state==='attachment'&&<section className={s.attachmentDraftCard}>Файл готов к отправке <button type="button">Убрать файл</button></section>}
  {state==='error'&&<p className={s.error}>Не удалось отправить сообщение. Повторите попытку.</p>}
  <div className={s.composerRow}>
  <button aria-label="Прикрепить файл" type="button" className={s.iconButton}>+</button>
  <label className={s.field}><textarea aria-label="Сообщение" rows={2} value={draft} onChange={e=>setDraft(e.target.value)} /></label>
  <button aria-label="Записать голосовое сообщение" type="button" className={s.iconButton}>A</button>
  <button aria-label="Записать видео сообщение" type="button" className={s.iconButton}>V</button>
  <button aria-label="Отправить сообщение" type="button" className={s.primaryIconButton}>↑</button>
 </div></form></section>;
 const history=<section className={s.messagesPanel}><div className={s.messagesViewport} data-testid="history"><div className={s.messagesList}>{Array.from({length:count},(_,i)=><article key={i} className={isGroup?s.messageCard:s.messageBubble}>Сообщение {i+1}: достаточно длинный текст для проверки переноса строк.</article>)}</div></div></section>;
 const information=<section className={isGroup?s.groupInfoHeroCard:s.profilePanel}><button onClick={()=>setInfo(false)}>Назад к переписке</button><h2>Информация о переписке</h2>{Array.from({length:20},(_,i)=><p key={i}>Сведения {i+1}: длинный текст для проверки отдельного скролла информации.</p>)}</section>;
 if(showList)return <section><h2>Список переписок</h2><button onClick={()=>setShowList(false)} type="button">Открыть переписку</button></section>;
 return <div className={s.layout} data-fixture-calls={calls} data-fixture-refreshes={refreshes}><section className={s.heroCard} data-mobile-hidden="true"/><div className={s.workspace} data-mobile-thread-active="true">
  {isGroup?<section className={s.mainColumn} data-mobile-thread-active="true" data-testid={info?"information":undefined}>{info?information:<>{header}<section className={s.threadPanel}>{history}{composer}</section></>}</section>:
  <section className={s.threadPane} data-mobile-hidden="false"><div className={s.sectionCard}><div className={s.panelHeader}><div><h2>Переписка</h2></div><div className={s.headerActions}><button className={s.secondaryButton} onClick={()=>setShowList(true)} type="button">Назад к списку</button><button className={s.secondaryButton} onClick={()=>setRefreshes(refreshes+1)} type="button">Обновить thread</button></div></div><div className={s.threadLayout} data-testid={info?"information":undefined}>{info?information:<>{header}{history}{composer}</>}</div></div></section>}
 </div></div>;
}
createRoot(document.getElementById('root')).render(<BrowserRouter><LegacyAppShell><Conversation/></LegacyAppShell></BrowserRouter>);
