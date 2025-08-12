import axios from "axios";
import axiosRetry from "axios-retry";
import Movie from "../models/Movie.js";
import Show from "../models/Show.js";

// Configure axios-retry
axiosRetry(axios, {
  retries: 3,
  retryDelay: (retryCount) => {
    return retryCount * 1000; // Exponential backoff (1s, 2s, 3s)
  },
  retryCondition: (error) => {
    // Retry on network errors or specific status codes
    return (
      axiosRetry.isNetworkError(error) ||
      axiosRetry.isRetryableError(error) ||
      error.code === "ECONNRESET" ||
      (error.response && [429, 500, 502, 503, 504].includes(error.response.status))
    );
  },
});

// Helper function for TMDB API requests
const makeTmdbRequest = async (url) => {
  try {
    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${process.env.TMDB_API_KEY}` },
      timeout: 8000, // 8-second timeout
    });
    return response.data;
  } catch (error) {
    if (error.response) {
      // TMDB API returned an error response
      throw new Error(
        `TMDB API Error: ${error.response.status} - ${error.response.data?.status_message || "Unknown error"}`
      );
    } else if (error.request) {
      // No response received
      throw new Error("No response received from TMDB API");
    } else {
      // Request setup error
      throw new Error(`Error setting up request: ${error.message}`);
    }
  }
};

// API to get now playing movies from TMDB API
export const getNowPlayingMovies = async (req, res) => {
  try {
    const data = await makeTmdbRequest("https://api.themoviedb.org/3/movie/now_playing");
    const movies = data.results;
    
    res.json({ success: true, movies });
  } catch (error) {
    console.error("Error in getNowPlayingMovies:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to fetch now playing movies",
      error: error.message,
    });
  }
};

// API to add a new show to the database
export const addShow = async (req, res) => {
  try{
    const { movieId, showsInput, showPrice } = req.body;

    // Validate input
    if (!movieId || !showsInput || !showPrice) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields (movieId, showsInput, showPrice)",
      });
    }

    let movie = await Movie.findById(movieId);
    
    if (!movie) {
        // Fetch movie details and credits from TMDB API in parallel
        const [movieDetails, movieCredits] = await Promise.all([
          makeTmdbRequest(`https://api.themoviedb.org/3/movie/${movieId}`),
          makeTmdbRequest(`https://api.themoviedb.org/3/movie/${movieId}/credits`),
        ]);

        const movieDetailsToSave = {
          _id: movieId,
          title: movieDetails.title,
          overview: movieDetails.overview,
          poster_path: movieDetails.poster_path,
          backdrop_path: movieDetails.backdrop_path,
          genres: movieDetails.genres,
          casts: movieCredits.cast.slice(0, 10), // Only keep top 10 cast members
          release_date: movieDetails.release_date,
          original_language: movieDetails.original_language,
          tagline: movieDetails.tagline || "",
          vote_average: movieDetails.vote_average,
          runtime: movieDetails.runtime,
        };

        // Add movie to the database
        movie = await Movie.create(movieDetailsToSave);
    }  

      const showsToCreate = [];
        showsInput.forEach(show => {
            const showDate = show.date;
            show.time.forEach((time) => {
                const dateTimeString = `${showDate}T${time}`;
                showsToCreate.push({
                    movie: movieId,
                    showDateTime: new Date(dateTimeString),
                    showPrice,
                    occupiedSeats: {}
                })
            })
        });

        if(showsToCreate.length > 0){
            await Show.insertMany(showsToCreate);
        }
    res.json({ success: true, message: "Show added successfully" });
  } catch (error) {
    console.log(error);
    res.json({success: false, message: error.message});
  }
};

//API to get all shows from the database
export const getShows = async (req,res) => {
  try {
    const shows = await Show.find({showDateTime: {$gte: new Date()}}).populate('movie').sort({showDateTime: 1});

    //filter unique shows
    const uniqueShows = new Set(shows.map(show => show.movie));

    res.json({success: true, shows: Array.from(uniqueShows)});
  } catch (error) {
    console.log(error);
    res.json({success: false, message: error.message});
  }
}

//API to get a single show from the database.
export const getShow = async (req,res) => {
  try {
  const {movieId} = req.params;
  //get all upcoming shows for the movie
  const shows = await Show.find({movie: movieId, showDateTime: { $gte: new Date() }});

  const movie = await Movie.findById(movieId);
  const dateTime = {};

  shows.forEach((show) => {
    const date = show.showDateTime.toISOString().split("T")[0];
    if(!dateTime[date]){
      dateTime[date] = [];
    }
    dateTime[date].push({ time: show.showDateTime, showId: show._id });
  });

  res.json({success: true, movie, dateTime});
  } catch(error){
    console.log(error);
    res.json({success: false, message: error.message});
  }
}