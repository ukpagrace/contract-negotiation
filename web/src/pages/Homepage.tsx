import React from 'react';
import { ArrowRight, FileText, Shield, Users, Sparkles } from 'lucide-react';

interface HomePageProps {
//   onStart: () => void;
}

export const HomePage: React.FC<HomePageProps> = () => {
  return (
    <div className="max-w-4xl mx-auto text-center py-16 space-y-8">
      <div className="inline-flex items-center space-x-2 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 px-4 py-1.5 rounded-full text-sm">
        <Sparkles className="w-4 h-4" />
        <span>Next-Gen Smart Contract Negotiation</span>
      </div>

      <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight text-white leading-tight">
        Negotiate Contracts <br />
        <span className="bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
          Faster & Fairer.
        </span>
      </h1>

      <p className="text-lg text-slate-400 max-w-2xl mx-auto leading-relaxed">
        Eliminate redline friction. Invite your legal team and counterparties into a collaborative, real-time negotiation environment.
      </p>

      <div className="pt-4">
        <button
        //   onClick={onStart}
          className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-8 py-4 rounded-xl text-lg shadow-lg shadow-indigo-600/25 transition-all flex items-center space-x-3 mx-auto cursor-pointer"
        >
          <span>Start Negotiating</span>
          <ArrowRight className="w-5 h-5" />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-16 text-left">
        <div className="bg-slate-900/60 border border-slate-800 p-6 rounded-2xl">
          <FileText className="w-8 h-8 text-indigo-400 mb-4" />
          <h3 className="text-white font-semibold mb-2">Smart Clauses</h3>
          <p className="text-slate-400 text-sm">Automated risk analysis and suggested compromise language.</p>
        </div>
        <div className="bg-slate-900/60 border border-slate-800 p-6 rounded-2xl">
          <Users className="w-8 h-8 text-purple-400 mb-4" />
          <h3 className="text-white font-semibold mb-2">Team Roles</h3>
          <p className="text-slate-400 text-sm">Invite internal counsel and reviewers with custom permissions.</p>
        </div>
        <div className="bg-slate-900/60 border border-slate-800 p-6 rounded-2xl">
          <Shield className="w-8 h-8 text-pink-400 mb-4" />
          <h3 className="text-white font-semibold mb-2">Audit History</h3>
          <p className="text-slate-400 text-sm">Complete immutable trail of revisions and approvals.</p>
        </div>
      </div>
    </div>
  );
};