import type { ReactNode } from 'react'

/**
 * Pięć ekranów jednego produktu — ta sama nawigacja, ta sama przykładowa
 * przestrzeń robocza. To makiety aplikacji, o której jest rozmowa, a nie
 * podsumowania samej rozmowy.
 */
const FRAME = { width: 540, height: 330 }

const NAV = ['Spotkania', 'Kanwa', 'Walidacja', 'Sesje', 'Wyniki']

function Screen({
  active,
  title,
  meta,
  action,
  children,
}: {
  active: string
  title: string
  meta: string
  action: string
  children: ReactNode
}) {
  return (
    <div className="mk" style={FRAME}>
      <aside className="mk-nav">
        <div className="mk-logo">
          <span className="mk-logo-mark" />
          Loop
        </div>
        <ul>
          {NAV.map((item) => (
            <li key={item} className={item === active ? 'is-on' : ''}>
              <i />
              {item}
            </li>
          ))}
        </ul>
        <div className="mk-workspace">
          <span className="mk-avatar">BZ</span>
          Onboarding B2B
        </div>
      </aside>
      <section className="mk-main">
        <header className="mk-topbar">
          <div>
            <h4>{title}</h4>
            <p>{meta}</p>
          </div>
          <button className="mk-btn">{action}</button>
        </header>
        <div className="mk-content">{children}</div>
      </section>
    </div>
  )
}

function Meeting() {
  const transcript = [
    { who: 'Ania', text: 'Nowi klienci odpadają zanim dojdą do konfiguracji konta.' },
    { who: 'Marek', text: 'Może kreator w trzech krokach zamiast jednego długiego formularza?' },
    { who: 'Ania', text: 'I import danych z pliku, zamiast przepisywania ręcznie.' },
  ]
  return (
    <Screen active="Spotkania" title="Spotkanie na żywo" meta="Zespół Produkt · 12:04" action="Hard stop">
      <div className="mk-two">
        <div className="mk-stream">
          {transcript.map((line) => (
            <div key={line.text} className="mk-line">
              <span className="mk-avatar is-sm">{line.who[0]}</span>
              <p>{line.text}</p>
            </div>
          ))}
          <div className="mk-line is-ghost">
            <span className="mk-avatar is-sm">M</span>
            <p>słucham…</p>
          </div>
        </div>
        <div className="mk-panel">
          <div className="mk-panel-head">
            Wyłapane idee <b>7</b>
          </div>
          <ul className="mk-chips">
            <li className="is-done">Kreator w 3 krokach</li>
            <li className="is-done">Import z pliku</li>
            <li className="is-run">Podpowiedzi w polach</li>
          </ul>
          <div className="mk-progress">
            <span style={{ width: '64%' }} />
          </div>
          <p className="mk-note">Generuję makietę 2 z 3</p>
        </div>
      </div>
    </Screen>
  )
}

function CanvasScreen() {
  const variants = [
    { tag: 'v1', name: 'Jeden długi formularz', votes: 2, state: '' },
    { tag: 'v2', name: 'Kreator w 3 krokach', votes: 6, state: 'is-lead' },
    { tag: 'v3', name: 'Import z pliku', votes: 3, state: '' },
  ]
  return (
    <Screen active="Kanwa" title="Kanwa makiet" meta="3 warianty · gałąź „rejestracja”" action="Nowa gałąź">
      <div className="mk-grid3">
        {variants.map((variant) => (
          <article key={variant.tag} className={`mk-thumb ${variant.state}`}>
            <div className="mk-thumb-top">
              <span className="mk-tag">{variant.tag}</span>
              <span className="mk-votes">▲ {variant.votes}</span>
            </div>
            <div className="mk-wire">
              <span className="w-70" />
              <div className="mk-wire-row">
                <span className="tall" />
                <span className="tall" />
              </div>
              <span className="w-45" />
              <span className="mk-wire-btn" />
            </div>
            <p>{variant.name}</p>
          </article>
        ))}
      </div>
      <div className="mk-strip">
        <span>Wybrany wariant trafia do walidacji</span>
        <span className="mk-link">Porównaj v2 i v3 →</span>
      </div>
    </Screen>
  )
}

function Validation() {
  const reactions = [
    { label: 'kupiłbym', value: 38, tone: 'good' },
    { label: 'zastanowię się', value: 34, tone: 'mid' },
    { label: 'nie rozumiem', value: 18, tone: 'warn' },
    { label: 'odbijam', value: 10, tone: 'bad' },
  ]
  return (
    <Screen
      active="Walidacja"
      title="Walidacja wariantu v2"
      meta="200 symulowanych użytkowników · 18 s"
      action="Uruchom ponownie"
    >
      <div className="mk-metrics">
        <div className="mk-metric">
          <strong>38%</strong>
          <span>deklaruje zakup</span>
        </div>
        <div className="mk-metric">
          <strong>2,4×</strong>
          <span>lepiej niż v1</span>
        </div>
        <div className="mk-metric">
          <strong>18 s</strong>
          <span>czas przebiegu</span>
        </div>
      </div>
      <div className="mk-bar-stack">
        {reactions.map((reaction) => (
          <span key={reaction.label} className={`seg is-${reaction.tone}`} style={{ width: `${reaction.value}%` }} />
        ))}
      </div>
      <ul className="mk-legend">
        {reactions.map((reaction) => (
          <li key={reaction.label}>
            <i className={`is-${reaction.tone}`} />
            {reaction.label} <b>{reaction.value}%</b>
          </li>
        ))}
      </ul>
      <div className="mk-objections">
        <div className="mk-panel-head">Najczęstsze zarzuty</div>
        <ul>
          <li>
            <span>Nie wiem, ile to kosztuje</span>
            <b>41</b>
          </li>
          <li>
            <span>Za dużo pól w kroku 2</span>
            <b>27</b>
          </li>
        </ul>
      </div>
    </Screen>
  )
}

function Sessions() {
  const steps = [
    { label: 'Wejście', value: 100 },
    { label: 'Rejestracja', value: 88 },
    { label: 'Krok 2 kreatora', value: 74 },
    { label: 'Pierwszy import', value: 31 },
  ]
  return (
    <Screen
      active="Sesje"
      title="Replay prawdziwych sesji"
      meta="1 284 nagrań odtworzonych na wariancie v2"
      action="Eksportuj"
    >
      <div className="mk-funnel">
        {steps.map((step) => (
          <div key={step.label} className="mk-step">
            <span className="mk-step-label">{step.label}</span>
            <span className="mk-step-track">
              <span
                className={`mk-step-fill ${step.value < 50 ? 'is-drop' : ''}`}
                style={{ width: `${step.value}%` }}
              />
            </span>
            <span className="mk-step-value">{step.value}%</span>
          </div>
        ))}
      </div>
      <div className="mk-insight">
        <strong>Krok 2 zjada lejek.</strong> Użytkownicy czytają etykiety średnio 42 s i wychodzą. Skrócenie
        opisów przepuszcza w symulacji o 9 pkt więcej osób.
      </div>
    </Screen>
  )
}

function Results() {
  const variants = [
    { name: 'Wariant A', headline: 'Konto firmowe w 5 minut', ctr: '1,8%', cpa: '42 zł', win: false },
    { name: 'Wariant B', headline: 'Zaimportuj dane i zacznij dziś', ctr: '3,4%', cpa: '19 zł', win: true },
  ]
  return (
    <Screen active="Wyniki" title="Wyniki kampanii" meta="Meta Ads · 7 dni · budżet 1 200 zł" action="Skaluj B">
      <div className="mk-ads">
        {variants.map((variant) => (
          <article key={variant.name} className={`mk-ad ${variant.win ? 'is-win' : ''}`}>
            <div className="mk-ad-img" />
            <div className="mk-ad-body">
              <span className="mk-ad-name">
                {variant.name}
                {variant.win && <b> · wygrywa</b>}
              </span>
              <p>{variant.headline}</p>
              <div className="mk-ad-metrics">
                <span>
                  CTR <b>{variant.ctr}</b>
                </span>
                <span>
                  CPA <b>{variant.cpa}</b>
                </span>
              </div>
            </div>
          </article>
        ))}
      </div>
      <div className="mk-revenue">
        <div className="mk-spark">
          {[18, 26, 24, 38, 46, 61, 74].map((value, index) => (
            <span key={index} style={{ height: `${value}%` }} />
          ))}
        </div>
        <div>
          <strong>8 420 zł</strong>
          <span>przychód przypisany do wariantu B</span>
        </div>
      </div>
    </Screen>
  )
}

export const MOCKS: Record<string, () => JSX.Element> = {
  meeting: Meeting,
  canvas: CanvasScreen,
  validation: Validation,
  sessions: Sessions,
  results: Results,
}

export const MOCK_FRAME = FRAME
