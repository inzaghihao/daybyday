import { createRouter, createWebHistory } from 'vue-router'
import HomePage from '../components/HomePage.vue'
import StatsPage from '../components/StatsPage.vue'
import ProfilePage from '../components/ProfilePage.vue'
import AuthPage from '../components/AuthPage.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', redirect: '/home' },
    { path: '/home', name: 'home', component: HomePage },
    { path: '/stats', name: 'stats', component: StatsPage },
    { path: '/profile', name: 'profile', component: ProfilePage },
    { path: '/auth', name: 'auth', component: AuthPage },
    { path: '/:pathMatch(.*)*', redirect: '/home' },
  ],
  scrollBehavior() {
    return { top: 0 }
  },
})

export default router
