import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter} from 'react-router-dom';
import {LegacyAppShell} from '../../src/app/AppShell.tsx';
import {FeedbackSite, useProductionComposer} from 'virtual:composer-feedback';
import s from '../../src/pages/ChatsPage.module.css';
import '@fontsource/pt-sans/400.css';
import '@fontsource/pt-sans/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '../../src/styles/reset.css';
import '../../src/styles/tokens.css';
import '../../src/styles/global.css';

let calls = 0, failures = 0;
const noop = () => {};
const chats = {state: {actionErrorMessage: null, isSendingMessage: false}, clearFeedback: noop};
const cryptoRuntime = {
  state: {isActionPending: false},
  async sendEncryptedDirectMessageV2Content() {
    calls++;
    const mode = new URLSearchParams(location.search).get('mode');
    const response = await fetch('/__send?mode=' + mode, {method: 'POST'});
    if (!response.ok) throw new Error((await response.json()).message);
    throw new Error('Fixture must return an actual 503');
  },
};
const encryptedMediaAttachmentDraft = {isUploading: false, markSendFailed() {failures++;}, markSendSucceeded: noop};

function Conversation() {
  const session = useProductionComposer({chats, cryptoRuntime, encryptedMediaAttachmentDraft});
  const [actions, setActions] = useState(0);
  window.feedback = {report: () => ({calls, failures, text: session.composerText, error: session.composerError, pending: session.pending, actions})};
  return <div className={s.layout}>
    <section className={s.heroCard} data-mobile-hidden="true" />
    <div className={s.workspace} data-mobile-thread-active="true">
      <section className={s.threadPane} data-mobile-hidden="false">
        <div className={s.sectionCard}>
          <div className={s.panelHeader}><div><h2>Переписка</h2></div><div className={s.headerActions}>
            <button className={s.secondaryButton} onClick={() => setActions(actions + 1)} type="button">Назад к списку</button>
            <button className={s.secondaryButton} onClick={() => setActions(actions + 1)} type="button">Обновить thread</button>
          </div></div>
          <div className={s.threadLayout}>
            <section className={s.threadHero}>
              <div className={s.threadHeroRow}>
                <button className={s.threadIdentityButton} type="button"><div className={s.threadIdentity}>
                  <span className={`${s.avatarBadge} ${s.avatarBadgeLarge}`} aria-hidden="true">ПП</span>
                  <div><h3 className={s.threadTitle}>Переписка</h3><p className={s.threadEyebrow}>В сети</p></div>
                </div></button>
                <div className={s.threadStatusRow}><span className={s.statusBadge}>Новых: 2</span>
                  <button className={s.iconButton} aria-label="Позвонить" onClick={() => setActions(actions + 1)} type="button">☎</button>
                </div>
              </div>
            </section>
            <section className={s.messagesPanel}><div className={s.messagesViewport} data-testid="history">
              <div className={s.messagesList}>{Array.from({length: 50}, (_, i) => <article className={s.messageBubble} key={i}>Сообщение {i + 1}: проверка отдельного scroll history.</article>)}</div>
            </div></section>
            <section className={s.composerCard} ref={session.composerViewportRef} data-testid="composer">
              <form className={s.composer} onSubmit={session.handleComposerSubmit}>
                <FeedbackSite {...session} styles={s} />
                <div className={s.composerRow}>
                  <button className={s.iconButton} aria-label="Прикрепить файл" type="button">+</button>
                  <label className={s.field}><textarea aria-label="Сообщение" aria-describedby={session.composerFeedbackMessage ? session.composerFeedbackId : undefined}
                    value={session.composerText} onChange={session.onChange} onKeyDown={session.handleComposerKeyDown} rows={2} /></label>
                  <button className={s.iconButton} aria-label="Записать голосовое сообщение" type="button">A</button>
                  <button className={s.iconButton} aria-label="Записать видео сообщение" type="button">V</button>
                  <button className={s.primaryIconButton} aria-label="Отправить сообщение" type="submit">↑</button>
                </div>
              </form>
            </section>
          </div>
        </div>
      </section>
    </div>
  </div>;
}
createRoot(document.getElementById('root')).render(<BrowserRouter><LegacyAppShell><Conversation /></LegacyAppShell></BrowserRouter>);
