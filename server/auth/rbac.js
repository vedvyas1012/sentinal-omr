const ROLE_HOME = {
  invigilator: '/invigilator',
  moderator: '/moderator',
  hub_operator: '/hub',
  official: '/audit',
};

function roleHome(role) {
  return ROLE_HOME[role] || '/login';
}

module.exports = { roleHome };
