export const Database = {
  getSettings: () => {
     try {
       const s = localStorage.getItem('nihongo_loop_settings');
       return s ? JSON.parse(s) : {};
     } catch (e) {
       return {};
     }
  },
  updateSettings: (updates: any) => {
     try {
       const current = Database.getSettings();
       const next = { ...current, ...updates };
       localStorage.setItem('nihongo_loop_settings', JSON.stringify(next));
       window.dispatchEvent(new Event('storage'));
     } catch (e) {}
  }
};
