using Xunit;

// SentinelPaths.Root est un état global au processus : c'est voulu, l'application
// est un logiciel de bureau unique qui possède un seul dossier de données.
// Les tests qui le redirigent vers un bac à sable ne peuvent donc pas s'exécuter
// en parallèle sans se marcher dessus.
[assembly: CollectionBehavior(DisableTestParallelization = true)]
