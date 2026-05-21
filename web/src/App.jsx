import { Routes, Route } from 'react-router-dom'
import Navbar from './components/Navbar'
import HomePage from './pages/HomePage'
import CollisionPage from './pages/CollisionPage'
import ReportPage from './pages/ReportPage'
import HistoryPage from './pages/HistoryPage'
import KnowledgePage from './pages/KnowledgePage'
import MaterialsPage from './pages/MaterialsPage'

export default function App() {
  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/collision/:id" element={<CollisionPage />} />
          <Route path="/report/:id" element={<ReportPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/knowledge" element={<KnowledgePage />} />
          <Route path="/materials" element={<MaterialsPage />} />
        </Routes>
      </main>
    </div>
  )
}
