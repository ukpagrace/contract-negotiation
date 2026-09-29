import React from 'react';
import { Button } from '@/components/ui/button';

interface HomePageProps {
  onStart: () => void;
}

const steps = [
  { title: 'Draft or upload', body: 'Start from a blank page or a Word document, then invite the other side and your team.' },
  { title: 'Take turns', body: 'Each side marks up the contract and sends it back. Every change is tracked and must be accepted or rejected.' },
  { title: 'Sign', body: 'When nothing is left to resolve, both sides sign and the final version is locked.' },
];

export const HomePage: React.FC<HomePageProps> = ({ onStart }) => {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 md:py-20">
      <div className="sheet px-6 py-10 sm:px-12 sm:py-14">
        <p className="font-serif text-2xl leading-snug text-ink sm:text-[2rem]">
          4.2&ensp;Payment is due within <del className="hero-del">30</del> <ins className="hero-ins no-underline">45</ins>{' '}
          days of the invoice date.
        </p>
        <p className="mt-4 text-sm text-ink-muted">Suggested by Beta Ltd. Waiting for you to accept or reject.</p>
      </div>

      <h1 className="mt-14 mb-0 font-serif text-4xl font-medium leading-tight tracking-tight text-ink sm:text-5xl">
        Two sides, one document.
      </h1>
      <p className="mt-4 max-w-xl text-lg leading-relaxed text-ink-muted">
        Negotiate a contract with the other party in one place, taking turns until every change is agreed.
      </p>
      <Button size="lg" className="mt-8 h-11 px-6 text-base" onClick={onStart}>
        Start a contract
      </Button>

      <ol className="mt-16 grid gap-8 border-t border-rule pt-10 sm:grid-cols-3">
        {steps.map((step, index) => (
          <li key={step.title}>
            <span className="font-serif text-3xl text-action">{index + 1}</span>
            <h3 className="mt-2 font-medium text-ink">{step.title}</h3>
            <p className="mt-1 text-sm leading-relaxed text-ink-muted">{step.body}</p>
          </li>
        ))}
      </ol>
    </main>
  );
};
