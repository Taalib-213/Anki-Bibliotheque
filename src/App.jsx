import { useState, useEffect, useMemo, useCallback } from 'react'

const PAGE_SIZE = 50

// Normalise un texte pour la recherche :
// - minuscules
// - retire les diacritiques arabes (tachkīl) pour que "فتح" trouve "فَتَحَ"
// - retire les accents français (à → a, é → e, etc.)
const ARABIC_DIACRITICS = /[\u064B-\u0652\u0670\u0640]/g
function normalize(s) {
  if (!s) return ''
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // accents latins
    .replace(ARABIC_DIACRITICS, '')    // tachkīl arabe
}

// Hook simple pour "debouncer" la frappe (évite de filtrer à chaque touche
// quand il y a beaucoup de mots)
function useDebounced(value, delay = 200) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return v
}

export default function App() {
  const [courses, setCourses] = useState([])
  const [loadingCourses, setLoadingCourses] = useState(true)
  const [errorCourses, setErrorCourses] = useState(null)

  const [globalQuery, setGlobalQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState('Tous')

  // Cache du vocabulaire déjà chargé { [courseId]: array }
  const [vocabCache, setVocabCache] = useState({})
  // Cours dont le tableau est ouvert
  const [openCourseId, setOpenCourseId] = useState(null)
  // Statut de chargement par cours { [courseId]: 'loading' | 'error' | 'ok' }
  const [vocabStatus, setVocabStatus] = useState({})

  // 1. Charger courses.json au démarrage
  useEffect(() => {
    fetch('/data/courses.json')
      .then(r => {
        if (!r.ok) throw new Error('Impossible de charger la liste des cours')
        return r.json()
      })
      .then(data => {
        setCourses(data)
        setLoadingCourses(false)
      })
      .catch(err => {
        setErrorCourses(err.message)
        setLoadingCourses(false)
      })
  }, [])

  // 2. Liste des catégories construite automatiquement
  const categories = useMemo(() => {
    const set = new Set(courses.map(c => c.category).filter(Boolean))
    return ['Tous', ...Array.from(set).sort()]
  }, [courses])

  // 3. Filtrage des cours selon recherche + catégorie
  const debouncedGlobal = useDebounced(globalQuery, 150)
  const filteredCourses = useMemo(() => {
    const q = normalize(debouncedGlobal)
    return courses.filter(c => {
      if (activeCategory !== 'Tous' && c.category !== activeCategory) return false
      if (!q) return true
      return (
        normalize(c.title).includes(q) ||
        normalize(c.category).includes(q) ||
        normalize(c.description).includes(q) ||
        normalize(c.level).includes(q)
      )
    })
  }, [courses, debouncedGlobal, activeCategory])

  // 4. Ouvrir / fermer un tableau
  const toggleCourse = useCallback(async (course) => {
    // Refermer si déjà ouvert
    if (openCourseId === course.id) {
      setOpenCourseId(null)
      return
    }
    setOpenCourseId(course.id)
    // Déjà chargé ? on s'arrête
    if (vocabCache[course.id]) return

    setVocabStatus(s => ({ ...s, [course.id]: 'loading' }))
    try {
      const res = await fetch(course.vocabularyFile)
      if (!res.ok) throw new Error('Fichier vocabulaire introuvable')
      const data = await res.json()
      setVocabCache(c => ({ ...c, [course.id]: data }))
      setVocabStatus(s => ({ ...s, [course.id]: 'ok' }))
    } catch (err) {
      console.error(err)
      setVocabStatus(s => ({ ...s, [course.id]: 'error' }))
    }
  }, [openCourseId, vocabCache])

  return (
    <div className="app">
      <Header
        globalQuery={globalQuery}
        setGlobalQuery={setGlobalQuery}
        totalCourses={courses.length}
        categories={categories}
        activeCategory={activeCategory}
        setActiveCategory={setActiveCategory}
      />

      <main className="container">
        {loadingCourses && <p className="info-message">Chargement des cours…</p>}
        {errorCourses && <p className="error-message">Erreur : {errorCourses}</p>}

        {!loadingCourses && !errorCourses && filteredCourses.length === 0 && (
          <p className="info-message">Aucun cours ne correspond à votre recherche.</p>
        )}

        <div className="courses-grid">
          {filteredCourses.map(course => (
            <CourseCard
              key={course.id}
              course={course}
              isOpen={openCourseId === course.id}
              onToggle={() => toggleCourse(course)}
              vocab={vocabCache[course.id]}
              status={vocabStatus[course.id]}
            />
          ))}
        </div>
      </main>

      <footer className="footer">
        <p>Bibliothèque Anki — vocabulaire arabe</p>
      </footer>
    </div>
  )
}

function Header({ globalQuery, setGlobalQuery, totalCourses, categories, activeCategory, setActiveCategory }) {
  return (
    <header className="site-header">
      <div className="container">
        <h1 className="site-title">Bibliothèque Anki</h1>
        <p className="site-subtitle">
          Télécharge tes paquets Anki et consulte les tableaux de vocabulaire associés.
        </p>

        <div className="header-controls">
          <input
            type="search"
            className="search-input"
            placeholder="Rechercher un cours, une catégorie, un niveau…"
            value={globalQuery}
            onChange={e => setGlobalQuery(e.target.value)}
            aria-label="Recherche globale"
          />
          <span className="course-count">
            {totalCourses} cours disponible{totalCourses > 1 ? 's' : ''}
          </span>
        </div>

        <div className="category-filter" role="tablist">
          {categories.map(cat => (
            <button
              key={cat}
              className={`category-btn ${activeCategory === cat ? 'active' : ''}`}
              onClick={() => setActiveCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>
    </header>
  )
}

function CourseCard({ course, isOpen, onToggle, vocab, status }) {
  return (
    <article className="course-card">
      <header className="card-head">
        <h2 className="card-title">{course.title}</h2>
        <div className="card-meta">
          {course.category && <span className="badge badge-cat">{course.category}</span>}
          {course.level && <span className="badge badge-level">{course.level}</span>}
          {vocab && <span className="badge badge-count">{vocab.length} mots</span>}
        </div>
      </header>

      {course.description && <p className="card-desc">{course.description}</p>}

      <div className="card-actions">
        {course.ankiFiles?.map((f, i) => (
          <a key={i} href={f.file} download className="btn btn-primary">
            ⬇ {f.title}
          </a>
        ))}
        <button className="btn btn-secondary" onClick={onToggle}>
          {isOpen ? 'Masquer le tableau' : 'Voir le tableau'}
        </button>
      </div>

      {isOpen && (
        <div className="vocab-zone">
          {status === 'loading' && <p className="info-message">Chargement du vocabulaire…</p>}
          {status === 'error' && <p className="error-message">Erreur lors du chargement du vocabulaire.</p>}
          {vocab && <VocabTable vocab={vocab} />}
        </div>
      )}
    </article>
  )
}

function VocabTable({ vocab }) {
  const [query, setQuery] = useState('')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const debouncedQuery = useDebounced(query, 200)

  // Réinitialiser la pagination quand la recherche change
  useEffect(() => { setVisibleCount(PAGE_SIZE) }, [debouncedQuery])

  const filtered = useMemo(() => {
    const q = normalize(debouncedQuery)
    if (!q) return vocab
    return vocab.filter(row => {
      // Champs cherchables (on ignore les vides)
      const fields = [
        row.arabic, row.translation, row.past, row.present, row.masdar,
        row.singular, row.plural, row.synonym, row.opposite, row.harfJarr
      ]
      return fields.some(f => f && normalize(f).includes(q))
    })
  }, [vocab, debouncedQuery])

  const visible = filtered.slice(0, visibleCount)
  const hasMore = visibleCount < filtered.length

  return (
    <div className="vocab-container">
      <div className="vocab-toolbar">
        <input
          type="search"
          className="search-input small"
          placeholder="Rechercher dans ce tableau (arabe ou français)…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          aria-label="Recherche dans le tableau"
        />
        <span className="vocab-count">
          {filtered.length} mot{filtered.length > 1 ? 's' : ''}
          {filtered.length !== vocab.length && ` sur ${vocab.length}`}
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="info-message">Aucun mot ne correspond à votre recherche.</p>
      ) : (
        <>
          {/* Vue tableau pour écrans larges */}
          <div className="table-wrapper">
            <table className="vocab-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Arabe</th>
                  <th>Traduction</th>
                  <th>Détails</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row, i) => <VocabRow key={i} row={row} />)}
              </tbody>
            </table>
          </div>

          {/* Vue cartes pour mobile */}
          <div className="vocab-cards">
            {visible.map((row, i) => <VocabMobileCard key={i} row={row} />)}
          </div>

          {hasMore && (
            <div className="load-more-zone">
              <button
                className="btn btn-secondary"
                onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
              >
                Afficher {Math.min(PAGE_SIZE, filtered.length - visibleCount)} mots de plus
              </button>
              <span className="load-more-info">
                {visibleCount} / {filtered.length}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// Petit helper : renvoie une liste de paires [label, value] non vides
function detailsFor(row) {
  if (row.type === 'verbe') {
    return [
      ['Passé', row.past],
      ['Présent', row.present],
      ['Masdar', row.masdar],
      ['Harf Jarr', row.harfJarr],
    ].filter(([, v]) => v && v.trim() !== '')
  }
  // nom / adjectif
  return [
    ['Singulier', row.singular],
    ['Pluriel', row.plural],
    ['Synonyme', row.synonym],
    ['Contraire', row.opposite],
  ].filter(([, v]) => v && v.trim() !== '')
}

function VocabRow({ row }) {
  const details = detailsFor(row)
  return (
    <tr>
      <td><span className={`type-pill type-${row.type}`}>{row.type}</span></td>
      <td><span className="arabic-text">{row.arabic}</span></td>
      <td className="translation-cell">{row.translation}</td>
      <td>
        <div className="detail-grid">
          {details.map(([label, value]) => (
            <div key={label} className="detail-item">
              <span className="detail-label">{label}</span>
              <span className={value.match(/[\u0600-\u06FF]/) ? 'arabic-text small' : 'detail-value'}>
                {value}
              </span>
            </div>
          ))}
        </div>
      </td>
    </tr>
  )
}

function VocabMobileCard({ row }) {
  const details = detailsFor(row)
  return (
    <div className="vocab-mobile-card">
      <div className="vmc-head">
        <span className="arabic-text">{row.arabic}</span>
        <span className={`type-pill type-${row.type}`}>{row.type}</span>
      </div>
      <div className="vmc-translation">{row.translation}</div>
      {details.length > 0 && (
        <div className="detail-grid">
          {details.map(([label, value]) => (
            <div key={label} className="detail-item">
              <span className="detail-label">{label}</span>
              <span className={value.match(/[\u0600-\u06FF]/) ? 'arabic-text small' : 'detail-value'}>
                {value}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
